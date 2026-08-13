import { expect, test } from '@playwright/test'
import {
  normalizeTerminalWheel,
  TERMINAL_WHEEL_MAX_LINES,
} from '../../shared/src/lib/terminalScroll'

test.describe('terminal wheel normalization', () => {
  test('accumulates precise trackpad pixels into terminal rows', () => {
    let remainder = 0
    const emitted: number[] = []
    for (let index = 0; index < 5; index++) {
      const result = normalizeTerminalWheel({
        deltaY: -4,
        deltaMode: 0,
        lineHeight: 20,
        viewportRows: 40,
        remainder,
      })
      remainder = result.remainder
      if (result.lines) emitted.push(result.lines)
    }
    expect(emitted).toEqual([-1])
    expect(Math.abs(remainder)).toBeLessThan(0.000001)
  })

  test('bounds a large first wheel event and discards its overflow', () => {
    const result = normalizeTerminalWheel({
      deltaY: -240,
      deltaMode: 0,
      lineHeight: 20,
      viewportRows: 40,
      remainder: 0,
    })
    expect(result).toEqual({ lines: -TERMINAL_WHEEL_MAX_LINES, remainder: 0 })
  })

  test('normalizes line and page wheel modes through the same limit', () => {
    expect(normalizeTerminalWheel({
      deltaY: 2,
      deltaMode: 1,
      lineHeight: 20,
      viewportRows: 40,
      remainder: 0,
    })).toEqual({ lines: 2, remainder: 0 })

    expect(normalizeTerminalWheel({
      deltaY: 1,
      deltaMode: 2,
      lineHeight: 20,
      viewportRows: 40,
      remainder: 0,
    })).toEqual({ lines: TERMINAL_WHEEL_MAX_LINES, remainder: 0 })
  })
})
