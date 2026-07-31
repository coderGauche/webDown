export const SIDE_PANEL_FOCUS_TARGETS = [
  'archive-file-name',
  'render-wait',
  'capture-concurrency',
  'capture-progress',
  'capture-result',
  'task-history',
] as const;

export type SidePanelFocusTarget = (typeof SIDE_PANEL_FOCUS_TARGETS)[number];

export type ArchiveFieldValidity = {
  archiveFileName: boolean;
  renderWait: boolean;
  concurrency: boolean;
};

export function getFirstInvalidArchiveFocusTarget(
  validity: ArchiveFieldValidity,
): SidePanelFocusTarget | null {
  if (!validity.archiveFileName) return 'archive-file-name';
  if (!validity.renderWait) return 'render-wait';
  if (!validity.concurrency) return 'capture-concurrency';
  return null;
}

export function getPostActionFocusTarget(
  action: 'capture-updated' | 'history-opened' | 'history-mutated',
): SidePanelFocusTarget {
  if (action === 'capture-updated') return 'capture-progress';
  if (action === 'history-opened') return 'capture-result';
  return 'task-history';
}
