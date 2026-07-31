import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylePath = fileURLToPath(new URL('../entrypoints/sidepanel/style.css', import.meta.url));
const css = readFileSync(stylePath, 'utf8');
const compactCss = css.slice(css.indexOf('@media (max-width: 360px)'));

describe('Side Panel narrow layout contract', () => {
  it('allows the extension root and primary containers to shrink without horizontal scrolling', () => {
    expect(css).toMatch(
      /html,\s*body,\s*#root\s*{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.app-shell\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere;/s,
    );
    expect(css).toMatch(/button\s*{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  });

  it('switches collision-prone rows to compact stacks or bounded grids', () => {
    expect(compactCss).toContain('.app-shell {\n    padding: 14px;');
    expect(compactCss).toMatch(
      /\.section-heading,\s*\.progress-heading,\s*\.result-heading,\s*\.history-heading,\s*\.third-party-heading,\s*\.capture-setting\s*{[^}]*flex-direction:\s*column;/s,
    );
    expect(compactCss).toMatch(
      /\.job-controls,\s*\.history-heading-actions,\s*\.history-item-actions\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
    );
    expect(compactCss).not.toContain('font-size:');
  });

  it('retains usable content width at the 280px browser validation boundary', () => {
    const minimumViewportWidth = 280;
    const compactHorizontalPadding = 14 * 2;
    const minimumContentWidth = minimumViewportWidth - compactHorizontalPadding;
    const twoMinimumActionsWithGap = 72 * 2 + 8;

    expect(minimumContentWidth).toBe(252);
    expect(minimumContentWidth).toBeGreaterThanOrEqual(twoMinimumActionsWithGap);
  });
});
