const PACKAGE_ERROR_CATEGORIES = [
  ['mime', 'MimeType'],
  ['redirect', 'RedirectTrace'],
  ['path mapping', 'PathMapping'],
  ['local path', 'LocalPath'],
  ['archive path', 'ArchivePath'],
  ['byte length', 'ByteLength'],
  ['sha-256', 'IntegrityHash'],
  ['integrity', 'Integrity'],
  ['manifest', 'Manifest'],
  ['zip', 'Zip'],
] as const;

/** Converts an internal package failure into a protocol-safe, non-sensitive code. */
export function classifyArchivePackageError(error: unknown): string {
  const name =
    error instanceof Error && /^(?:TypeError|RangeError|Error)$/.test(error.name)
      ? error.name
      : 'Error';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const category =
    PACKAGE_ERROR_CATEGORIES.find(([needle]) => message.includes(needle))?.[1] ?? 'Unknown';
  return `${name}.${category}`;
}
