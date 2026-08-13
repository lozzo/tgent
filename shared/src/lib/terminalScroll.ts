export const TERMINAL_WHEEL_MAX_LINES = 3
export const TERMINAL_WHEEL_FAST_MAX_LINES = 9

interface NormalizeTerminalWheelOptions {
  deltaY: number
  deltaMode: number
  lineHeight: number
  viewportRows: number
  remainder: number
  maxLines?: number
}

export interface NormalizedTerminalWheel {
  lines: number
  remainder: number
}

/** Convert browser wheel units to bounded terminal rows without losing trackpad precision. */
export function normalizeTerminalWheel({
  deltaY,
  deltaMode,
  lineHeight,
  viewportRows,
  remainder,
  maxLines = TERMINAL_WHEEL_MAX_LINES,
}: NormalizeTerminalWheelOptions): NormalizedTerminalWheel {
  if (!Number.isFinite(deltaY) || deltaY === 0) return { lines: 0, remainder }

  const safeLineHeight = Math.max(1, lineHeight)
  let deltaLines = deltaY / safeLineHeight
  if (deltaMode === 1) deltaLines = deltaY
  else if (deltaMode === 2) deltaLines = deltaY * Math.max(1, viewportRows)

  const accumulated = remainder + deltaLines
  const wholeLines = Math.trunc(accumulated)
  if (wholeLines === 0) return { lines: 0, remainder: accumulated }

  const boundedLines = Math.max(-maxLines, Math.min(maxLines, wholeLines))
  return {
    lines: boundedLines,
    remainder: boundedLines === wholeLines ? accumulated - wholeLines : 0,
  }
}
