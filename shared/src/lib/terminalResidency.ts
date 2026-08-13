export const DESKTOP_WARM_TAB_LIMIT = 2
export const DESKTOP_WARM_TAB_TTL_MS = 30_000

/** Keep the active tab and the most recently used tabs resident in xterm. */
export function nextWarmTerminalTabs(
  current: readonly string[],
  activeTabId: string,
  validTabIds: readonly string[],
  limit = DESKTOP_WARM_TAB_LIMIT,
): string[] {
  const valid = new Set(validTabIds)
  const next = [activeTabId, ...current]
    .filter((tabId, index, values) => valid.has(tabId) && values.indexOf(tabId) === index)
    .slice(0, Math.max(1, limit))
  return next
}

export function equalTerminalTabOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tabId, index) => tabId === right[index])
}
