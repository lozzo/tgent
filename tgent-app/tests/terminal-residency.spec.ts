import { expect, test } from '@playwright/test'
import {
  DESKTOP_WARM_TAB_LIMIT,
  DESKTOP_WARM_TAB_TTL_MS,
  equalTerminalTabOrder,
  nextWarmTerminalTabs,
} from '../../shared/src/lib/terminalResidency'

test.describe('desktop terminal residency', () => {
  test('keeps the active and most recent terminal tabs warm', () => {
    let warm = nextWarmTerminalTabs([], 'tab-a', ['tab-a', 'tab-b', 'tab-c'])
    expect(warm).toEqual(['tab-a'])

    warm = nextWarmTerminalTabs(warm, 'tab-b', ['tab-a', 'tab-b', 'tab-c'])
    expect(warm).toEqual(['tab-b', 'tab-a'])

    warm = nextWarmTerminalTabs(warm, 'tab-c', ['tab-a', 'tab-b', 'tab-c'])
    expect(warm).toEqual(['tab-c', 'tab-b'])
    expect(warm).toHaveLength(DESKTOP_WARM_TAB_LIMIT)
    expect(DESKTOP_WARM_TAB_TTL_MS).toBe(30_000)
  })

  test('drops closed tabs and preserves stable ordering', () => {
    const warm = nextWarmTerminalTabs(['tab-c', 'tab-b'], 'tab-c', ['tab-a', 'tab-c'])
    expect(warm).toEqual(['tab-c'])
    expect(equalTerminalTabOrder(warm, ['tab-c'])).toBe(true)
    expect(equalTerminalTabOrder(warm, ['tab-a'])).toBe(false)
  })
})
