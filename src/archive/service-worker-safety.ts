import { parse, type Node } from 'acorn';

export const SERVICE_WORKER_POLICY_ATTRIBUTE = 'data-sitecapsule-service-worker-policy';
export const SERVICE_WORKER_POLICY_VALUE = 'block-registration-v1';
export const SERVICE_WORKER_BLOCK_FUNCTION = '__sitecapsuleBlockServiceWorkerRegistration_v1__';

export const SERVICE_WORKER_SCRIPT_KINDS = [
  'inline-classic',
  'inline-module',
  'external',
  'non-javascript',
] as const;
export const SERVICE_WORKER_SCRIPT_STATUSES = [
  'rewritten',
  'runtime-guard-only',
  'no-registration',
  'parse-error',
  'ignored',
] as const;
export const SERVICE_WORKER_POLICY_LIMITATIONS = [
  'external-script-runtime-guard-only',
  'dynamic-or-aliased-call-runtime-guard-only',
  'unparseable-inline-script-runtime-guard-only',
  'computed-aliases-not-statically-resolved',
] as const;

export type ServiceWorkerScriptKind = (typeof SERVICE_WORKER_SCRIPT_KINDS)[number];
export type ServiceWorkerScriptStatus = (typeof SERVICE_WORKER_SCRIPT_STATUSES)[number];
export type ServiceWorkerPolicyLimitation = (typeof SERVICE_WORKER_POLICY_LIMITATIONS)[number];

export type ServiceWorkerRegistrationChange = {
  startOffset: number;
  endOffset: number;
  calleePath: string;
  replacement: string;
};

export type ServiceWorkerScriptResult = {
  elementOrdinal: number;
  kind: ServiceWorkerScriptKind;
  status: ServiceWorkerScriptStatus;
  directRegistrationsRewritten: number;
  dynamicOrAliasedReferences: number;
  parseError: boolean;
  changes: ServiceWorkerRegistrationChange[];
};

export type ServiceWorkerSafetyResult = {
  guardInserted: boolean;
  guardPosition: 'head-first';
  directRegistrationsRewritten: number;
  externalScriptsGuarded: number;
  dynamicOrAliasedReferences: number;
  parseErrors: number;
  scripts: ServiceWorkerScriptResult[];
  limitations: ServiceWorkerPolicyLimitation[];
};

type AstNode = Node & Record<string, unknown>;

type Replacement = {
  start: number;
  end: number;
  value: string;
  calleePath: string;
};

const JAVASCRIPT_MIME_TYPES = new Set([
  '',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
]);
const GLOBAL_NAVIGATOR_ROOTS = new Set(['window', 'globalThis', 'self']);
const BLOCK_EXPRESSION = `globalThis.${SERVICE_WORKER_BLOCK_FUNCTION}()`;
const GUARD_SOURCE = `(()=>{const n=${JSON.stringify(
  SERVICE_WORKER_BLOCK_FUNCTION,
)};const deny=()=>Promise.reject(new DOMException("Service Worker registration is disabled in this SiteCapsule archive.","SecurityError"));try{Object.defineProperty(globalThis,n,{value:deny,writable:false,configurable:false})}catch{}const c=globalThis.navigator?.serviceWorker;if(!c)return;for(const target of [c,Object.getPrototypeOf(c)]){if(!target)continue;try{Object.defineProperty(target,"register",{value:deny,writable:false,configurable:false})}catch{}}})();`;

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    Number.isSafeInteger((value as { start?: unknown }).start) &&
    Number.isSafeInteger((value as { end?: unknown }).end)
  );
}

function visitAst(
  node: AstNode,
  visitor: (node: AstNode, parent: AstNode | null) => void,
  parent: AstNode | null = null,
): void {
  visitor(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    if (isAstNode(value)) visitAst(value, visitor, node);
    else if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) visitAst(child, visitor, node);
      }
    }
  }
}

function unwrapChain(node: AstNode): AstNode {
  return node.type === 'ChainExpression' && isAstNode(node.expression)
    ? unwrapChain(node.expression)
    : node;
}

function staticPropertyName(node: AstNode): string | null {
  const property = node.property;
  if (!isAstNode(property)) return null;
  if (
    node.computed !== true &&
    property.type === 'Identifier' &&
    typeof property.name === 'string'
  ) {
    return property.name;
  }
  if (node.computed === true && property.type === 'Literal' && typeof property.value === 'string') {
    return property.value;
  }
  return null;
}

function staticMemberPath(input: AstNode): string[] | null {
  const node = unwrapChain(input);
  if (node.type === 'Identifier' && typeof node.name === 'string') return [node.name];
  if (node.type !== 'MemberExpression' || !isAstNode(node.object)) return null;
  const objectPath = staticMemberPath(node.object);
  const propertyName = staticPropertyName(node);
  return objectPath && propertyName ? [...objectPath, propertyName] : null;
}

function isNavigatorServiceWorkerPath(path: readonly string[] | null): boolean {
  if (!path) return false;
  if (path.length === 2) return path[0] === 'navigator' && path[1] === 'serviceWorker';
  return (
    path.length === 3 &&
    GLOBAL_NAVIGATOR_ROOTS.has(path[0] ?? '') &&
    path[1] === 'navigator' &&
    path[2] === 'serviceWorker'
  );
}

function isDirectRegistrationPath(path: readonly string[] | null): boolean {
  return path?.at(-1) === 'register' && isNavigatorServiceWorkerPath(path.slice(0, -1));
}

function callCallee(node: AstNode): AstNode | null {
  if (node.type !== 'CallExpression' || !isAstNode(node.callee)) return null;
  return unwrapChain(node.callee);
}

function applyReplacements(source: string, replacements: readonly Replacement[]): string {
  let result = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    result = result.slice(0, replacement.start) + replacement.value + result.slice(replacement.end);
  }
  return result;
}

function scriptKind(script: HTMLScriptElement): ServiceWorkerScriptKind {
  const type = (script.getAttribute('type') ?? '').trim().toLowerCase();
  const executable = type === 'module' || JAVASCRIPT_MIME_TYPES.has(type);
  if (!executable) return 'non-javascript';
  if (script.hasAttribute('src')) return 'external';
  return type === 'module' ? 'inline-module' : 'inline-classic';
}

function analyzeInlineScript(
  source: string,
  kind: 'inline-classic' | 'inline-module',
  elementOrdinal: number,
): { source: string; result: ServiceWorkerScriptResult } {
  let program: AstNode;
  try {
    program = parse(source, {
      ecmaVersion: 'latest',
      sourceType: kind === 'inline-module' ? 'module' : 'script',
      allowHashBang: true,
    }) as unknown as AstNode;
  } catch {
    return {
      source,
      result: {
        elementOrdinal,
        kind,
        status: 'parse-error',
        directRegistrationsRewritten: 0,
        dynamicOrAliasedReferences: 0,
        parseError: true,
        changes: [],
      },
    };
  }

  const replacements: Replacement[] = [];
  const serviceWorkerReferences: AstNode[] = [];
  visitAst(program, (node) => {
    const callee = callCallee(node);
    const calleePath = callee ? staticMemberPath(callee) : null;
    if (callee && isDirectRegistrationPath(calleePath)) {
      replacements.push({
        start: node.start,
        end: node.end,
        value: BLOCK_EXPRESSION,
        calleePath: calleePath?.join('.') ?? 'navigator.serviceWorker.register',
      });
    }
    if (node.type === 'MemberExpression' && isNavigatorServiceWorkerPath(staticMemberPath(node))) {
      serviceWorkerReferences.push(node);
    }
  });

  const dynamicOrAliasedReferences = serviceWorkerReferences.filter(
    (reference) =>
      !replacements.some(
        (replacement) => replacement.start <= reference.start && replacement.end >= reference.end,
      ),
  ).length;
  const changes = replacements
    .sort((left, right) => left.start - right.start)
    .map((replacement): ServiceWorkerRegistrationChange => ({
      startOffset: replacement.start,
      endOffset: replacement.end,
      calleePath: replacement.calleePath,
      replacement: replacement.value,
    }));
  const status: ServiceWorkerScriptStatus =
    changes.length > 0
      ? 'rewritten'
      : dynamicOrAliasedReferences > 0
        ? 'runtime-guard-only'
        : 'no-registration';
  return {
    source: applyReplacements(source, replacements),
    result: {
      elementOrdinal,
      kind,
      status,
      directRegistrationsRewritten: changes.length,
      dynamicOrAliasedReferences,
      parseError: false,
      changes,
    },
  };
}

function createGuardScript(document: Document): HTMLScriptElement {
  const guard = document.createElement('script');
  guard.setAttribute(SERVICE_WORKER_POLICY_ATTRIBUTE, SERVICE_WORKER_POLICY_VALUE);
  guard.textContent = GUARD_SOURCE;
  return guard;
}

export function applyServiceWorkerSafetyPolicy(
  document: Document,
  elementOrdinals?: ReadonlyMap<Element, number>,
): ServiceWorkerSafetyResult {
  if (!document || typeof document.querySelectorAll !== 'function') {
    throw new TypeError('A DOM document is required for the Service Worker safety policy.');
  }

  for (const existing of Array.from(
    document.querySelectorAll(`script[${SERVICE_WORKER_POLICY_ATTRIBUTE}]`),
  )) {
    existing.remove();
  }
  const scripts = Array.from(document.querySelectorAll('script')) as HTMLScriptElement[];
  const fallbackOrdinals = new Map(scripts.map((script, index) => [script, index + 1]));
  const results: ServiceWorkerScriptResult[] = [];

  for (const script of scripts) {
    const elementOrdinal = elementOrdinals?.get(script) ?? fallbackOrdinals.get(script) ?? 0;
    const kind = scriptKind(script);
    if (kind === 'non-javascript') {
      results.push({
        elementOrdinal,
        kind,
        status: 'ignored',
        directRegistrationsRewritten: 0,
        dynamicOrAliasedReferences: 0,
        parseError: false,
        changes: [],
      });
      continue;
    }
    if (kind === 'external') {
      results.push({
        elementOrdinal,
        kind,
        status: 'runtime-guard-only',
        directRegistrationsRewritten: 0,
        dynamicOrAliasedReferences: 0,
        parseError: false,
        changes: [],
      });
      continue;
    }

    const analyzed = analyzeInlineScript(script.textContent ?? '', kind, elementOrdinal);
    if (analyzed.result.directRegistrationsRewritten > 0) script.textContent = analyzed.source;
    results.push(analyzed.result);
  }

  const head = document.head;
  if (!head) throw new Error('HTML document has no head for the Service Worker safety guard.');
  head.insertBefore(createGuardScript(document), head.firstChild);

  const directRegistrationsRewritten = results.reduce(
    (total, result) => total + result.directRegistrationsRewritten,
    0,
  );
  const externalScriptsGuarded = results.filter((result) => result.kind === 'external').length;
  const dynamicOrAliasedReferences = results.reduce(
    (total, result) => total + result.dynamicOrAliasedReferences,
    0,
  );
  const parseErrors = results.filter((result) => result.parseError).length;
  const limitations: ServiceWorkerPolicyLimitation[] = [];
  if (externalScriptsGuarded > 0) limitations.push('external-script-runtime-guard-only');
  if (dynamicOrAliasedReferences > 0) {
    limitations.push('dynamic-or-aliased-call-runtime-guard-only');
  }
  if (parseErrors > 0) limitations.push('unparseable-inline-script-runtime-guard-only');
  limitations.push('computed-aliases-not-statically-resolved');

  return {
    guardInserted: true,
    guardPosition: 'head-first',
    directRegistrationsRewritten,
    externalScriptsGuarded,
    dynamicOrAliasedReferences,
    parseErrors,
    scripts: results,
    limitations,
  };
}
