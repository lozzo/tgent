export interface DesktopTabPaneTitle {
  id: string
  terminalTitle: string
}

export function normalizeTerminalTitle(value: string, fallback = ''): string {
  const trimmed = value.trim()
  const withoutSpinner = trimmed.replace(/^[\u2800-\u28ff]+\s*/u, '').trim()
  return withoutSpinner || fallback
}

export function desktopTabTitle(
  activePaneId: string,
  panes: readonly DesktopTabPaneTitle[],
  fallback = 'Terminal',
): string {
  const title = normalizeTerminalTitle(panes.find(pane => pane.id === activePaneId)?.terminalTitle ?? '')
  return title || fallback
}
