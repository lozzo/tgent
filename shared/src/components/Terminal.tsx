import { useEffect, useLayoutEffect, useRef, useImperativeHandle, forwardRef, memo } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { SearchAddon } from '@xterm/addon-search'
import { TerminalClient, type PaneInfo, type TerminalFrame } from '../api/terminalClient'
import type { WebRTCTransport } from '../api/transport'
import { getTheme, loadThemeId, type ThemeDefinition } from '../lib/themes'
import { colorWithOpacity, loadDesktopSettings, type DesktopSettings } from '../lib/desktopSettings'
import {
  normalizeTerminalWheel,
  TERMINAL_WHEEL_FAST_MAX_LINES,
  TERMINAL_WHEEL_MAX_LINES,
} from '../lib/terminalScroll'
import { loadTerminalSettings, type TerminalSettings } from '../lib/terminalSettings'
import { translateError } from '../lib/errors'
import {
  isWailsApp,
  interceptWailsTerminalPaste,
  createWailsPasteEventGate,
  pulseWailsWindowSurface,
  readWailsTerminalClipboard,
  writeWailsTerminalClipboardText,
  type WailsClipboardImage,
} from '../lib/platform'
import { eventBus } from '../state/EventBus'
import '@xterm/xterm/css/xterm.css'

const getChromeMajor = () => {
  const match = navigator.userAgent.match(/(?:Chrome|Chromium|CriOS)\/(\d+)/)
  return match ? Number(match[1]) : 0
}

const shouldUseDomRenderer = () => {
  const major = getChromeMajor()
  return major > 0 && major < 80
}

export type ConnStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export type LoadingStage = 'dc-creating' | 'dc-opened' | 'snapshot-received' | ''

export interface TerminalResizeState {
  mode: 'owner' | 'observer' | 'fixed'
  columns: number
  rows: number
  scale: number
}

interface TerminalProps {
  paneId: string
  webrtcTransport?: WebRTCTransport
  ctrlActive?: boolean
  altActive?: boolean
  preventFocus?: boolean
  selectionMode?: boolean
  searchActive?: boolean
  onCursorMove?: () => void
  onModifierUsed?: () => void
  onConnStatusChange?: (status: ConnStatus, attempt?: number) => void
  onPaneInfo?: (info: PaneInfo) => void
  onResizeStateChange?: (state: TerminalResizeState) => void
  onReady?: () => void
  onPaneClosed?: () => void
  onStageChange?: (stage: LoadingStage) => void
  onBufferChange?: (isAlternate: boolean) => void
  /** 系统键盘输入回调（用于分屏同步输入） */
  onInput?: (data: string) => void
  /** 收到 PTY 输出或终端快照时触发，用于桌面端活动监视。 */
  onOutputActivity?: () => void
  /** Resolve a native clipboard image to the path visible from this terminal. */
  onPasteClipboardImage?: (image: WailsClipboardImage) => Promise<string>
  /** Keep receiving PTY data while pausing xterm work for a hidden desktop tab. */
  suspended?: boolean
}

export interface TerminalHandle {
  sendInput: (data: string) => void
  sendKeys: (keys: string) => void
  focus: () => void
  /** Redraw the retained xterm buffer after its tab becomes visible. */
  reactivate: () => void
  blur: () => void
  setFontSize: (size: number) => void
  getFontSize: () => number
  updateOptions: (opts: { fontSize?: number; fontFamily?: string; scrollback?: number; cursorBlink?: boolean }) => void
  getCursorInfo: () => { cursorY: number; rows: number; lineHeight: number } | null
  adjustInputPosition: (bottomOffset: number) => void
  getBufferType: () => 'normal' | 'alternate'
  reconnect: () => void
  /** 轻量级重新绑定 — 只恢复 bridge channel，不清屏不重载 snapshot */
  reattach: () => void
  /** 窗口恢复焦点时校验本地网格，并在尺寸变化后获取匹配的新快照。 */
  syncViewport: () => void
  /** Coalesce a structural desktop layout change into one final xterm resize. */
  prepareLayoutChange: (settleMs?: number) => void
  /** Explicitly take ownership of the shared tmux pane dimensions. */
  takeResizeControl: () => void
  // 选择相关
  selectAll: () => void
  selectVisible: () => void
  getSelection: () => string
  hasSelection: () => boolean
  clearSelection: () => void
  // 粘贴
  pasteText: (text: string) => void
  // 搜索
  searchNext: (query: string) => boolean
  searchPrevious: (query: string) => boolean
  clearSearch: () => void
  clearScrollback: () => void
}

export default memo(forwardRef<TerminalHandle, TerminalProps>(function Terminal(
  { paneId, webrtcTransport, ctrlActive, altActive, preventFocus, selectionMode, searchActive, onCursorMove, onModifierUsed, onConnStatusChange, onPaneInfo, onResizeStateChange, onReady, onPaneClosed, onStageChange, onBufferChange, onInput, onOutputActivity, onPasteClipboardImage, suspended = false },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const clientRef = useRef<TerminalClient | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const frameResetRef = useRef<() => void>(() => {})
  const frameScaleRef = useRef<() => void>(() => {})
  const frameGridRef = useRef(false)
  const frameViewerResizeRef = useRef(false)
  const resizeOwnerRef = useRef<boolean | null>(null)
  const followRemoteGridRef = useRef(false)
  const windowActiveRef = useRef(typeof document === 'undefined' || document.hasFocus())
  const takeResizeControlRef = useRef<() => void>(() => {})
  const remoteSizeRef = useRef({ cols: 0, rows: 0 })
  const viewportSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewportSyncReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewportSyncInFlightRef = useRef(false)
  const surfacePulseActiveRef = useRef(false)
  const layoutSettlingRef = useRef(false)
  const layoutAwaitingSnapshotRef = useRef(false)
  const layoutExpectedSizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const layoutReassertResizeRef = useRef(false)
  const prepareLayoutChangeRef = useRef<(settleMs?: number) => void>(() => {})
  const suspendedRef = useRef(suspended)
  const suspendedDirtyRef = useRef(false)
  const replaceNextSnapshotRef = useRef(false)
  const configuredScrollbackRef = useRef(5000)
  const configuredCursorBlinkRef = useRef(true)
  const suspendRendererRef = useRef<() => void>(() => {})
  const resumeRendererRef = useRef<() => void>(() => {})
  const propsRef = useRef({ paneId: '', webrtcTransport })
  const prevTransportRef = useRef<WebRTCTransport | undefined>(undefined)
  const ctrlRef = useRef(false)
  const altRef = useRef(false)
  const preventFocusRef = useRef(false)
  const selectionModeRef = useRef(false)
  const searchActiveRef = useRef(false)
  const modifierUsedRef = useRef<(() => void) | undefined>()
  const cursorMoveRef = useRef<(() => void) | undefined>()
  const connStatusRef = useRef<((s: ConnStatus, a?: number) => void) | undefined>()
  const paneInfoRef = useRef<((i: PaneInfo) => void) | undefined>()
  const resizeStateRef = useRef<((state: TerminalResizeState) => void) | undefined>()
  const onReadyRef = useRef<(() => void) | undefined>()
  const paneClosedRef = useRef<(() => void) | undefined>()
  const stageRef = useRef<((s: LoadingStage) => void) | undefined>()
  const bufferChangeRef = useRef<((isAlt: boolean) => void) | undefined>()
  const onInputRef = useRef<((data: string) => void) | undefined>()
  const outputActivityRef = useRef<(() => void) | undefined>()
  const pasteClipboardImageRef = useRef<((image: WailsClipboardImage) => Promise<string>) | undefined>()
  // Focus can be requested in the first animation frame after a tab switch,
  // before passive effects run. Keep this guard current during render.
  preventFocusRef.current = !!preventFocus

  useImperativeHandle(ref, () => ({
    sendInput: (d: string) => clientRef.current?.sendInput(d),
    sendKeys: (k: string) => clientRef.current?.sendKeys(k),
    focus: () => termRef.current?.focus(),
    reactivate: () => {
      const term = termRef.current
      const fit = fitAddonRef.current
      const container = containerRef.current
      if (!term || !fit || !container || container.clientWidth <= 1 || container.clientHeight <= 1) return
      if (layoutSettlingRef.current) {
        if (!preventFocusRef.current) term.focus()
        return
      }
      if (followRemoteGridRef.current) {
        frameScaleRef.current()
      } else {
        const proposed = fit.proposeDimensions()
        if (proposed && proposed.cols > 0 && proposed.rows > 0 &&
            (proposed.cols !== term.cols || proposed.rows !== term.rows)) {
          fit.fit()
        }
      }
      // xterm pauses its renderer while the tab surface is display:none. A
      // refresh here is coalesced with its IntersectionObserver resume paint.
      term.refresh(0, term.rows - 1)
      if (!preventFocusRef.current) term.focus()
    },
    blur: () => { containerRef.current?.querySelector('textarea')?.blur() },
    setFontSize: (size: number) => {
      const term = termRef.current
      const fit = fitAddonRef.current
      const ws = clientRef.current
      if (!term || !fit) return
      term.options.fontSize = size
      if ((!frameGridRef.current || frameViewerResizeRef.current) && !followRemoteGridRef.current) {
        frameResetRef.current()
        fit.fit()
        ws?.sendResize(term.cols, term.rows)
      } else {
        requestAnimationFrame(() => frameScaleRef.current())
      }
    },
    getFontSize: () => termRef.current?.options.fontSize ?? 14,
    updateOptions: (opts) => {
      const term = termRef.current
      const fit = fitAddonRef.current
      const ws = clientRef.current
      if (!term || !fit) return
      if (opts.fontSize !== undefined) term.options.fontSize = opts.fontSize
      if (opts.fontFamily !== undefined) term.options.fontFamily = opts.fontFamily
      if (opts.scrollback !== undefined) {
        configuredScrollbackRef.current = opts.scrollback
        if (!suspendedRef.current) term.options.scrollback = opts.scrollback
      }
      if (opts.cursorBlink !== undefined) {
        configuredCursorBlinkRef.current = opts.cursorBlink
        if (!suspendedRef.current) term.options.cursorBlink = opts.cursorBlink
      }
      if ((!frameGridRef.current || frameViewerResizeRef.current) && !followRemoteGridRef.current) {
        frameResetRef.current()
        fit.fit()
        ws?.sendResize(term.cols, term.rows)
      } else {
        requestAnimationFrame(() => frameScaleRef.current())
      }
    },
    getCursorInfo: () => {
      const term = termRef.current
      if (!term) return null
      const lineHeight = Math.ceil((term.element?.getBoundingClientRect().height ?? 0) / term.rows) || 20
      return { cursorY: term.buffer.active.cursorY, rows: term.rows, lineHeight }
    },
    getBufferType: () => (termRef.current?.buffer.active.type ?? 'normal') as 'normal' | 'alternate',
    adjustInputPosition: (bottomOffset: number) => {
      const term = termRef.current
      const el = term?.element
      const container = containerRef.current
      if (!el || !container) return
      const compOverlay = container.querySelector('.comp-overlay') as HTMLElement | null
      if (bottomOffset > 0) {
        el.classList.add('input-adjusted')
        el.style.setProperty('--kb-input-bottom', `${bottomOffset}px`)
        if (compOverlay) compOverlay.style.bottom = `${bottomOffset}px`
      } else {
        el.classList.remove('input-adjusted')
        el.style.removeProperty('--kb-input-bottom')
        if (compOverlay) compOverlay.style.bottom = ''
      }
    },
    reconnect: () => {
      const client = clientRef.current
      const term = termRef.current
      if (!client || !term) return
      const { paneId: pid, webrtcTransport: wt } = propsRef.current
      if (!wt) return
      connStatusRef.current?.('connecting')
      stageRef.current?.('dc-creating')
      frameResetRef.current()
      client.disconnect()
      term.clear()
      term.reset()
      client.connect(pid, wt)
    },
    reattach: () => {
      const client = clientRef.current
      if (!client) return
      const { webrtcTransport: wt } = propsRef.current
      if (!wt) return
      // 只重建 bridge channel 映射，xterm 内容保持不变
      client.reattach(wt)
      // 恢复 focus — app 后台切回或网络恢复后 textarea 可能已丢失焦点
      if (!preventFocusRef.current) termRef.current?.focus()
    },
    syncViewport: () => {
      if (surfacePulseActiveRef.current || layoutSettlingRef.current) return
      const container = containerRef.current
      if (!container || container.clientWidth <= 1 || container.clientHeight <= 1) return
      windowActiveRef.current = true
      const term = termRef.current
      const fit = fitAddonRef.current
      const client = clientRef.current
      if (followRemoteGridRef.current) {
        frameScaleRef.current()
        if (!preventFocusRef.current) term?.focus()
        return
      }
      const proposed = fit?.proposeDimensions()
      if (!term || !client || !proposed || proposed.cols <= 0 || proposed.rows <= 0) return

      const remote = remoteSizeRef.current
      if (remote.cols === proposed.cols && remote.rows === proposed.rows) {
        if (!preventFocusRef.current) term.focus()
        return
      }
      if (viewportSyncInFlightRef.current) return

      const { paneId: pid, webrtcTransport: transport } = propsRef.current
      if (!pid || !transport) return
      viewportSyncInFlightRef.current = true
      // An owner may restore its own viewport after an external tmux resize,
      // but focus alone must never steal dimensions from another viewer.
      client.sendResize(proposed.cols, proposed.rows)
      if (viewportSyncTimerRef.current) clearTimeout(viewportSyncTimerRef.current)
      viewportSyncTimerRef.current = setTimeout(() => {
        viewportSyncTimerRef.current = null
        client.requestSnapshot(true)
        if (viewportSyncReleaseTimerRef.current) clearTimeout(viewportSyncReleaseTimerRef.current)
        viewportSyncReleaseTimerRef.current = setTimeout(() => {
          viewportSyncReleaseTimerRef.current = null
          viewportSyncInFlightRef.current = false
        }, 3_000)
      }, 160)
    },
    prepareLayoutChange: (settleMs) => prepareLayoutChangeRef.current(settleMs),
    takeResizeControl: () => takeResizeControlRef.current(),
    selectAll: () => { termRef.current?.selectAll() },
    selectVisible: () => {
      const term = termRef.current
      if (!term) return
      const buf = term.buffer.active
      const startRow = buf.viewportY
      term.select(0, startRow, term.cols * term.rows)
    },
    getSelection: () => termRef.current?.getSelection() ?? '',
    hasSelection: () => termRef.current?.hasSelection() ?? false,
    clearSelection: () => { termRef.current?.clearSelection() },
    pasteText: (text: string) => {
      const ws = clientRef.current
      if (!ws) return
      const isMultiline = text.includes('\n') || text.includes('\r')
      if (isMultiline) {
        ws.sendInput('\x1b[200~' + text + '\x1b[201~')
      } else {
        ws.sendInput(text)
      }
    },
    searchNext: (query: string) => {
      const sa = searchAddonRef.current
      if (!sa || !query) return false
      return sa.findNext(query)
    },
    searchPrevious: (query: string) => {
      const sa = searchAddonRef.current
      if (!sa || !query) return false
      return sa.findPrevious(query)
    },
    clearSearch: () => {
      searchAddonRef.current?.clearDecorations()
    },
    clearScrollback: () => {
      termRef.current?.clear()
    },
  }))

  useEffect(() => { ctrlRef.current = !!ctrlActive }, [ctrlActive])
  useEffect(() => { altRef.current = !!altActive }, [altActive])
  useEffect(() => { selectionModeRef.current = !!selectionMode }, [selectionMode])
  useEffect(() => { searchActiveRef.current = !!searchActive }, [searchActive])
  useEffect(() => { modifierUsedRef.current = onModifierUsed }, [onModifierUsed])
  useEffect(() => { cursorMoveRef.current = onCursorMove }, [onCursorMove])
  useEffect(() => { connStatusRef.current = onConnStatusChange }, [onConnStatusChange])
  useEffect(() => { paneInfoRef.current = onPaneInfo }, [onPaneInfo])
  useEffect(() => { resizeStateRef.current = onResizeStateChange }, [onResizeStateChange])
  useEffect(() => { onReadyRef.current = onReady }, [onReady])
  useEffect(() => { paneClosedRef.current = onPaneClosed }, [onPaneClosed])
  useEffect(() => { stageRef.current = onStageChange }, [onStageChange])
  useEffect(() => { bufferChangeRef.current = onBufferChange }, [onBufferChange])
  useEffect(() => { onInputRef.current = onInput }, [onInput])
  useEffect(() => { outputActivityRef.current = onOutputActivity }, [onOutputActivity])
  useEffect(() => { pasteClipboardImageRef.current = onPasteClipboardImage }, [onPasteClipboardImage])
  useLayoutEffect(() => {
    const wasSuspended = suspendedRef.current
    suspendedRef.current = suspended
    const term = termRef.current

    if (suspended) {
      // Cold tabs keep only the lightweight terminal transport. Their screen can
      // be reconstructed from tmux, so retaining scrollback and a GPU context is
      // unnecessary and makes memory grow linearly with the number of tabs.
      suspendedDirtyRef.current = true
      suspendRendererRef.current()
      if (term) {
        term.options.cursorBlink = false
        term.options.scrollback = 0
      }
      return
    }

    if (!wasSuspended) return
    if (term) {
      term.options.scrollback = configuredScrollbackRef.current
      term.options.cursorBlink = configuredCursorBlinkRef.current
    }
    resumeRendererRef.current()
    if (!suspendedDirtyRef.current) return

    suspendedDirtyRef.current = false
    replaceNextSnapshotRef.current = true
    frameResetRef.current()
    clientRef.current?.requestSnapshot(false)
  }, [suspended])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false

    ;(async () => {
    const isMobile = window.innerWidth < 768
    const desktopSurface = Boolean(container.closest('.desktop-live-workspace'))
    const [theme, termSettings, desktopSettings] = await Promise.all([
      loadThemeId().then(getTheme),
      loadTerminalSettings(),
      desktopSurface ? loadDesktopSettings() : Promise.resolve(null),
    ])
    let activeTheme = theme
    configuredScrollbackRef.current = termSettings.scrollback
    configuredCursorBlinkRef.current = termSettings.cursorBlink
    let desktopBackgroundOpacity = desktopSettings?.appearance.windowOpacity ?? 1
    const resolvedTerminalTheme = (definition: ThemeDefinition) => ({
      ...definition.terminal,
      background: colorWithOpacity(definition.terminal.background, desktopBackgroundOpacity),
    })
    const terminalFontSize = isMobile ? Math.max(10, termSettings.fontSize - 2) : termSettings.fontSize
    try {
      await document.fonts?.load(`${terminalFontSize}px ${termSettings.fontFamily}`)
    } catch { /* use the configured fallback font */ }
    if (disposed) return
    const term = new XTerm({
      cursorBlink: suspendedRef.current ? false : termSettings.cursorBlink,
      fontSize: terminalFontSize,
      fontFamily: termSettings.fontFamily,
      scrollback: suspendedRef.current ? 0 : termSettings.scrollback,
      theme: resolvedTerminalTheme(theme),
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    term.open(container)
    // 确保 .xterm 元素裁剪偏移后的 .xterm-screen，露出的区域只显示自身背景色
    if (term.element) term.element.style.overflow = 'hidden'


    const textarea = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null
    const onFocus = () => { if (preventFocusRef.current && textarea) textarea.blur() }
    textarea?.addEventListener('focus', onFocus)

    // 移动端自定义输入法合成文本浮层（替代 xterm 默认的单行 composition-view）
    const compOverlay = document.createElement('div')
    compOverlay.className = 'comp-overlay'
    if (term.element) term.element.appendChild(compOverlay)
    let compositionFrame = 0
    const containDesktopComposition = () => {
      if (!desktopSurface) return
      cancelAnimationFrame(compositionFrame)
      compositionFrame = requestAnimationFrame(() => {
        const compositionView = term.element?.querySelector('.composition-view') as HTMLElement | null
        if (!compositionView) return
        const terminalBounds = container.getBoundingClientRect()
        const compositionBounds = compositionView.getBoundingClientRect()
        const overflow = compositionBounds.right - terminalBounds.right + 4
        if (overflow > 0) {
          const currentLeft = Number.parseFloat(getComputedStyle(compositionView).left)
          if (Number.isFinite(currentLeft)) compositionView.style.left = `${Math.max(0, currentLeft - overflow)}px`
        }
        const clampedBounds = compositionView.getBoundingClientRect()
        compositionView.style.maxWidth = `${Math.max(24, terminalBounds.right - Math.max(terminalBounds.left, clampedBounds.left) - 4)}px`
        compositionView.style.overflow = 'hidden'
        compositionView.style.textOverflow = 'ellipsis'
      })
    }
    const onCompStart = () => {
      if (isMobile) {
        compOverlay.style.display = 'block'
        compOverlay.textContent = ''
      }
      containDesktopComposition()
    }
    const onCompUpdate = (e: CompositionEvent) => {
      if (isMobile) compOverlay.textContent = e.data
      containDesktopComposition()
    }
    const onCompEnd = () => {
      cancelAnimationFrame(compositionFrame)
      compOverlay.style.display = 'none'
      compOverlay.textContent = ''
    }
    textarea?.addEventListener('compositionstart', onCompStart)
    textarea?.addEventListener('compositionupdate', onCompUpdate)
    textarea?.addEventListener('compositionend', onCompEnd)

    // 渲染器三级降级：WebGL → CanvasAddon → DOM（默认）
    // - auto: 尝试 WebGL，context loss 时降级到 CanvasAddon
    // - webgl: 强制 WebGL
    // - canvas: 直接用 CanvasAddon（跳过 WebGL）
    let rendererAddon: { dispose: () => void } | null = null
    const loadCanvasFallback = () => {
      if (rendererAddon || suspendedRef.current) return
      try {
        const canvas = new CanvasAddon()
        term.loadAddon(canvas)
        rendererAddon = canvas
      } catch { /* fall back to DOM renderer */ }
    }

    const activateRenderer = () => {
      if (rendererAddon || suspendedRef.current) return
      if (termSettings.renderer === 'auto' && shouldUseDomRenderer()) return
      if (termSettings.renderer === 'canvas') {
        loadCanvasFallback()
        return
      }
      try {
        const webgl = new WebglAddon(true)
        webgl.onContextLoss(() => {
          if (rendererAddon !== webgl) return
          webgl.dispose()
          rendererAddon = null
          loadCanvasFallback()
          term.refresh(0, term.rows - 1)
        })
        term.loadAddon(webgl)
        rendererAddon = webgl
      } catch {
        loadCanvasFallback()
      }
    }
    const suspendRenderer = () => {
      rendererAddon?.dispose()
      rendererAddon = null
    }
    suspendRendererRef.current = suspendRenderer
    resumeRendererRef.current = activateRenderer
    activateRenderer()

    fitAddon.fit()

    // Ordinary window resizing remains immediate. Structural pane removal can
    // explicitly gate this observer so all intermediate boxes collapse into one
    // final tmux grid and one authoritative snapshot.
    let lastSentCols = term.cols, lastSentRows = term.rows
    let resizeDebounce: ReturnType<typeof setTimeout> | undefined
    let layoutSettleTimer: ReturnType<typeof setTimeout> | undefined
    let layoutSnapshotTimer: ReturnType<typeof setTimeout> | undefined
    let layoutSnapshotFallbackTimer: ReturnType<typeof setTimeout> | undefined
    let layoutSettleDelay = 180
    let layoutSettleDeadline = 0
    const RESIZE_SETTLE = 150
    let readyNotified = false
    let initialSurfacePulseTimer: ReturnType<typeof setTimeout> | undefined
    let initialViewportRenderForced = false
    let surfacePulseReleaseTimer: ReturnType<typeof setTimeout> | undefined
    let surfaceFinalSnapshotTimer: ReturnType<typeof setTimeout> | undefined
    const forceInitialViewportRender = () => {
      if (initialViewportRenderForced) return
      initialViewportRenderForced = true
      surfacePulseActiveRef.current = true
      clearTimeout(resizeDebounce)
      void pulseWailsWindowSurface()
      surfacePulseReleaseTimer = setTimeout(() => {
        surfacePulseReleaseTimer = undefined
        surfacePulseActiveRef.current = false
        if (followRemoteGridRef.current || !windowActiveRef.current) {
          term.refresh(0, term.rows - 1)
          applyFrameScale()
          return
        }
        fitAddon.fit()
        term.refresh(0, term.rows - 1)
        lastSentCols = term.cols
        lastSentRows = term.rows
        const remote = remoteSizeRef.current
        if (remote.cols !== term.cols || remote.rows !== term.rows) {
          ws.sendResize(term.cols, term.rows)
          surfaceFinalSnapshotTimer = setTimeout(() => {
            surfaceFinalSnapshotTimer = undefined
            ws.requestSnapshot(true)
          }, 180)
        }
      }, 900)
    }
    let frameScaleRaf = 0
    let lastResizeStateKey = ''
    const emitResizeState = (scale = 1) => {
      const remote = remoteSizeRef.current
      const mode: TerminalResizeState['mode'] = !frameViewerResizeRef.current
        ? 'fixed'
        : resizeOwnerRef.current === false ? 'observer' : 'owner'
      const state: TerminalResizeState = {
        mode,
        columns: remote.cols || term.cols,
        rows: remote.rows || term.rows,
        scale: Math.max(0.01, Math.min(1, scale)),
      }
      const key = `${state.mode}:${state.columns}:${state.rows}:${state.scale.toFixed(3)}`
      container.dataset.resizeMode = state.mode
      if (key === lastResizeStateKey) return
      lastResizeStateKey = key
      resizeStateRef.current?.(state)
    }
    const clearFrameScale = () => {
      cancelAnimationFrame(frameScaleRaf)
      const element = term.element
      if (!element) return
      element.style.position = ''
      element.style.inset = ''
      element.style.width = ''
      element.style.minWidth = ''
      element.style.height = ''
      element.style.transform = ''
      element.style.transformOrigin = ''
      container.style.overflow = ''
      container.style.overscrollBehaviorX = ''
      container.style.touchAction = ''
      delete container.dataset.horizontalPan
      container.scrollLeft = 0
      emitResizeState(1)
    }
    const applyFrameScale = () => {
      cancelAnimationFrame(frameScaleRaf)
      frameScaleRaf = requestAnimationFrame(() => {
        if (!frameGridRef.current && !followRemoteGridRef.current) return
        const element = term.element
        const screen = element?.querySelector('.xterm-screen') as HTMLElement | null
        if (!element || !screen || container.clientWidth <= 0 || container.clientHeight <= 0) return

        // Observer mode keeps the remote grid and font at their real size. A
        // narrower client pans over that grid horizontally instead of shrinking
        // glyphs and making the terminal difficult to read.
        const previousScrollLeft = container.scrollLeft
        element.style.transform = 'none'
        const screenRect = screen.getBoundingClientRect()
        const sourceWidth = Math.max(1, screenRect.width)
        const sourceHeight = Math.max(1, screenRect.height)
        element.style.position = 'relative'
        element.style.inset = ''
        element.style.width = `${sourceWidth}px`
        element.style.minWidth = `${sourceWidth}px`
        element.style.height = `${Math.max(container.clientHeight, sourceHeight)}px`
        element.style.transformOrigin = ''
        container.style.overflowX = sourceWidth > container.clientWidth ? 'auto' : 'hidden'
        container.style.overflowY = 'hidden'
        container.style.overscrollBehaviorX = 'contain'
        container.style.touchAction = 'pan-x'
        container.dataset.horizontalPan = 'true'
        const maxScrollLeft = Math.max(0, sourceWidth - container.clientWidth)
        container.scrollLeft = Math.min(previousScrollLeft, maxScrollLeft)
        emitResizeState(1)
      })
    }
    frameScaleRef.current = applyFrameScale
    const takeResizeControl = () => {
      windowActiveRef.current = true
      if (!frameViewerResizeRef.current) return
      const proposed = fitAddon.proposeDimensions()
      if (!proposed || proposed.cols <= 0 || proposed.rows <= 0) return
      resizeOwnerRef.current = true
      followRemoteGridRef.current = false
      replaceNextSnapshotRef.current = true
      clearFrameScale()
      fitAddon.fit()
      lastSentCols = term.cols
      lastSentRows = term.rows
      ws.sendResize(term.cols, term.rows, true)
      if (viewportSyncTimerRef.current) clearTimeout(viewportSyncTimerRef.current)
      viewportSyncTimerRef.current = setTimeout(() => {
        viewportSyncTimerRef.current = null
        ws.requestSnapshot(true)
      }, 180)
    }
    takeResizeControlRef.current = takeResizeControl

    const finishLayoutSnapshot = () => {
      if (!layoutAwaitingSnapshotRef.current) return
      layoutAwaitingSnapshotRef.current = false
      layoutExpectedSizeRef.current = null
      layoutReassertResizeRef.current = false
      clearTimeout(layoutSnapshotTimer)
      clearTimeout(layoutSnapshotFallbackTimer)
      layoutSnapshotTimer = undefined
      layoutSnapshotFallbackTimer = undefined
    }
    const commitLayoutChange = () => {
      layoutSettleTimer = undefined
      layoutSettlingRef.current = false
      delete container.dataset.layoutSettling
      if (container.clientWidth <= 1 || container.clientHeight <= 1) {
        layoutAwaitingSnapshotRef.current = false
        layoutExpectedSizeRef.current = null
        layoutReassertResizeRef.current = false
        replaceNextSnapshotRef.current = false
        return
      }

      clearTimeout(resizeDebounce)
      if ((!layoutReassertResizeRef.current && followRemoteGridRef.current) ||
          (frameGridRef.current && !frameViewerResizeRef.current)) {
        layoutExpectedSizeRef.current = null
        applyFrameScale()
      } else {
        const proposed = fitAddon.proposeDimensions()
        if (proposed && proposed.cols > 0 && proposed.rows > 0) {
          layoutExpectedSizeRef.current = { cols: proposed.cols, rows: proposed.rows }
          lastSentCols = proposed.cols
          lastSentRows = proposed.rows
          // Do not fit the retained canvas yet. The final snapshot applies the
          // new grid and pixels together, avoiding a blank intermediate redraw.
          if (layoutReassertResizeRef.current) {
            resizeOwnerRef.current = true
            followRemoteGridRef.current = false
          }
          ws.sendResize(proposed.cols, proposed.rows, layoutReassertResizeRef.current)
        }
      }

      clearTimeout(layoutSnapshotTimer)
      layoutSnapshotTimer = setTimeout(() => {
        layoutSnapshotTimer = undefined
        ws.requestSnapshot(true)
      }, 650)
      clearTimeout(layoutSnapshotFallbackTimer)
      layoutSnapshotFallbackTimer = setTimeout(() => {
        layoutSnapshotFallbackTimer = undefined
        if (!layoutAwaitingSnapshotRef.current) return
        layoutAwaitingSnapshotRef.current = false
        layoutExpectedSizeRef.current = null
        layoutReassertResizeRef.current = false
        replaceNextSnapshotRef.current = false
        if (followRemoteGridRef.current) applyFrameScale()
        else fitAddon.fit()
        term.refresh(0, term.rows - 1)
      }, 2_200)
    }
    const scheduleLayoutCommit = () => {
      clearTimeout(layoutSettleTimer)
      const remaining = Math.max(0, layoutSettleDeadline - performance.now())
      layoutSettleTimer = setTimeout(commitLayoutChange, Math.min(layoutSettleDelay, remaining))
    }
    prepareLayoutChangeRef.current = (settleMs = 180) => {
      layoutSettleDelay = Math.max(80, Math.min(320, settleMs))
      layoutSettleDeadline = performance.now() + 640
      layoutReassertResizeRef.current = resizeOwnerRef.current === true
      layoutSettlingRef.current = true
      layoutAwaitingSnapshotRef.current = true
      layoutExpectedSizeRef.current = null
      replaceNextSnapshotRef.current = true
      container.dataset.layoutSettling = 'true'
      clearTimeout(resizeDebounce)
      scheduleLayoutCommit()
    }
    const handleResize = () => {
      // display:none tabs briefly report a zero-sized box while switching. A
      // fit at that point collapses the xterm grid and can resize tmux to 11x5.
      if (container.clientWidth <= 1 || container.clientHeight <= 1) {
        clearTimeout(resizeDebounce)
        return
      }
      if (layoutSettlingRef.current) {
        scheduleLayoutCommit()
        return
      }
      if (!windowActiveRef.current) {
        if (followRemoteGridRef.current) applyFrameScale()
        return
      }
      if (followRemoteGridRef.current) {
        applyFrameScale()
        return
      }
      if (frameGridRef.current) {
        if (!frameViewerResizeRef.current) {
          applyFrameScale()
          return
        }
        clearFrameScale()
      }
      fitAddon.fit()
      LINE_HEIGHT_PX = getLineHeight()
      if (surfacePulseActiveRef.current) {
        clearTimeout(resizeDebounce)
        return
      }
      // 防抖发送 resize，避免键盘动画期间频繁向 tmux 发送尺寸变更
      clearTimeout(resizeDebounce)
      resizeDebounce = setTimeout(() => {
        if (term.cols === lastSentCols && term.rows === lastSentRows) return
        lastSentCols = term.cols
        lastSentRows = term.rows
        ws.sendResize(term.cols, term.rows)
      }, RESIZE_SETTLE)
    }
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(handleResize)
      : null
    if (resizeObserver) {
      resizeObserver.observe(container)
    } else {
      window.addEventListener('resize', handleResize)
    }

    let frameInitialized = false
    let frameRendering = false
    let pendingFrame: TerminalFrame | null = null
    let frameGeneration = 0
    let frameApplicationMode = false
    const resetFrameState = () => {
      frameGeneration++
      frameInitialized = false
      frameRendering = false
      pendingFrame = null
      frameGridRef.current = false
      if (frameApplicationMode) {
        frameApplicationMode = false
        container.dataset.terminalApplicationMode = 'false'
        bufferChangeRef.current?.(term.buffer.active.type === 'alternate')
      }
      clearFrameScale()
    }
    frameResetRef.current = resetFrameState

    let lastOutputActivityAt = -Infinity
    const notifyOutputActivity = () => {
      const now = performance.now()
      if (now - lastOutputActivityAt < 1_000) return
      lastOutputActivityAt = now
      outputActivityRef.current?.()
    }

    const renderFrame = (frame: TerminalFrame) => {
      notifyOutputActivity()
      if (frame.columns && frame.rows) {
        remoteSizeRef.current = { cols: frame.columns, rows: frame.rows }
      }
      if (layoutSettlingRef.current) {
        replaceNextSnapshotRef.current = true
        return
      }
      const expectedLayoutSize = layoutExpectedSizeRef.current
      if (expectedLayoutSize && frame.columns && frame.rows &&
          (frame.columns !== expectedLayoutSize.cols || frame.rows !== expectedLayoutSize.rows)) {
        replaceNextSnapshotRef.current = true
        return
      }
      finishLayoutSnapshot()
      if (suspendedRef.current) {
        suspendedDirtyRef.current = true
        return
      }
      replaceNextSnapshotRef.current = false
      if (frameRendering) {
        pendingFrame = frame
        return
      }
      const initial = !frameInitialized
      const generation = frameGeneration
      frameInitialized = true
      frameRendering = true
      frameGridRef.current = true
      const nextApplicationMode = !!frame.application_mode
      if (nextApplicationMode !== frameApplicationMode) {
        frameApplicationMode = nextApplicationMode
        container.dataset.terminalApplicationMode = String(frameApplicationMode)
        bufferChangeRef.current?.(frameApplicationMode || term.buffer.active.type === 'alternate')
      }
      stageRef.current?.('snapshot-received')

      const snapCols = frame.columns || term.cols
      const snapRows = frame.rows || term.rows
      if (snapCols !== term.cols || snapRows !== term.rows) term.resize(snapCols, snapRows)
      applyFrameScale()

      const sanitize = (line: string) => frame.ansi
        ? line
        : line.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '?')
      let text = ''
      if (initial) {
        term.reset()
        if (frame.scrollback?.length) {
          text += frame.scrollback.map(sanitize).join('\r\n') + '\r\n'
          text += '\n'.repeat(Math.max(0, snapRows - 1))
        }
      }
      text += '\x1b[?25l\x1b[H\x1b[2J\x1b[H'
      text += frame.lines.map(sanitize).join('\r\n')
      text += '\x1b[0m'
      const cursorX = Math.max(0, Math.min(snapCols - 1, frame.cursor_x || 0))
      const cursorY = Math.max(0, Math.min(snapRows - 1, frame.cursor_y || 0))
      text += `\x1b[${cursorY + 1};${cursorX + 1}H`
      text += frame.cursor_visible ? '\x1b[?25h' : '\x1b[?25l'

      term.write(text, () => {
        if (generation !== frameGeneration) return
        frameRendering = false
        term.scrollToBottom()
        applyFrameScale()
        connStatusRef.current?.('connected')
        viewportSyncInFlightRef.current = false
        if (viewportSyncReleaseTimerRef.current) {
          clearTimeout(viewportSyncReleaseTimerRef.current)
          viewportSyncReleaseTimerRef.current = null
        }
        if (initial) {
          requestAnimationFrame(() => {
            readyNotified = true
            onReadyRef.current?.()
          })
        }
        const next = pendingFrame
        pendingFrame = null
        if (next) renderFrame(next)
      })
    }

    const ws = new TerminalClient({
      onOutput: (data) => {
        notifyOutputActivity()
        if (suspendedRef.current || replaceNextSnapshotRef.current) {
          suspendedDirtyRef.current = true
          return
        }
        term.write(data)
        if (!readyNotified) {
          readyNotified = true
          requestAnimationFrame(() => onReadyRef.current?.())
        }
      },
      onPaneState: (text, snapCols, snapRows) => {
        notifyOutputActivity()
        if (snapCols > 0 && snapRows > 0) {
          remoteSizeRef.current = { cols: snapCols, rows: snapRows }
        }
        if (layoutSettlingRef.current) {
          replaceNextSnapshotRef.current = true
          return
        }
        const expectedLayoutSize = layoutExpectedSizeRef.current
        if (expectedLayoutSize && snapCols > 0 && snapRows > 0 &&
            (snapCols !== expectedLayoutSize.cols || snapRows !== expectedLayoutSize.rows)) {
          replaceNextSnapshotRef.current = true
          return
        }
        const acceptingLayoutSnapshot = expectedLayoutSize !== null
        finishLayoutSnapshot()
        if (suspendedRef.current) {
          suspendedDirtyRef.current = true
          connStatusRef.current?.('connected')
          return
        }
        if (replaceNextSnapshotRef.current) {
          replaceNextSnapshotRef.current = false
          term.reset()
        }
        resetFrameState()
        stageRef.current?.('snapshot-received')
        // pane 尺寸变化时先按远端网格渲染；非 owner 通过外层视口横向查看。
        const mismatch = snapCols > 0 && snapRows > 0 && (snapCols !== term.cols || snapRows !== term.rows)
        // A snapshot with a different grid is authoritative. Keep it as an
        // observer view until the user explicitly takes size control instead
        // of immediately resizing tmux back and starting a resize loop.
        const preserveRemoteGrid = followRemoteGridRef.current || (mismatch && !acceptingLayoutSnapshot)
        if (acceptingLayoutSnapshot) followRemoteGridRef.current = false
        else if (mismatch) followRemoteGridRef.current = true
        if (mismatch) {
          term.resize(snapCols, snapRows)
        }
        term.write(text, () => {
          if (preserveRemoteGrid) {
            followRemoteGridRef.current = true
            applyFrameScale()
          }
          term.scrollToBottom()
          // WKWebView's WebGL renderer can miss the first paint after parsing a
          // large scrollback snapshot. Force the visible rows dirty once the
          // write queue has committed the complete terminal state.
          term.refresh(0, term.rows - 1)
          // Mobile/Web use this single snapshot as-is. WKWebView occasionally
          // misses its first WebGL paint, so pulse the native surface once,
          // without replaying the same viewport into xterm first.
          if (isWailsApp() && !initialViewportRenderForced && !initialSurfacePulseTimer) {
            initialSurfacePulseTimer = setTimeout(() => {
              initialSurfacePulseTimer = undefined
              forceInitialViewportRender()
            }, 200)
          }
          connStatusRef.current?.('connected')
          viewportSyncInFlightRef.current = false
          if (viewportSyncReleaseTimerRef.current) {
            clearTimeout(viewportSyncReleaseTimerRef.current)
            viewportSyncReleaseTimerRef.current = null
          }
          // 双 rAF：等浏览器完成至少一次 paint 再通知 ready
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              readyNotified = true
              onReadyRef.current?.()
            })
          })
        })
      },
      onFrame: renderFrame,
      onError: (msg) => {
        term.write(`\r\n\x1b[31m错误: ${translateError(msg)}\x1b[0m\r\n`)
        // 错误时解除遮罩，让用户可以看到错误信息
        onReadyRef.current?.()
      },
      onClose: () => { connStatusRef.current?.('disconnected'); term.write('\r\n\x1b[33m[连接已断开]\x1b[0m\r\n') },
      onOpen: () => {
        stageRef.current?.('dc-opened')
        fitAddon.fit()
        lastSentCols = term.cols
        lastSentRows = term.rows
        ws.sendResize(term.cols, term.rows)
        // 不在此处设置 connected，统一由 onPaneState 快照写入后触发，
        // 避免过早暴露终端导致闪烁
      },
      onPaneInfo: (info) => {
        frameViewerResizeRef.current = !!info.viewer_resize
        const layoutGateActive = layoutSettlingRef.current || layoutAwaitingSnapshotRef.current
        const previousOwner = resizeOwnerRef.current
        if (layoutGateActive && layoutReassertResizeRef.current) {
          resizeOwnerRef.current = true
        } else {
          resizeOwnerRef.current = info.resize_owner ?? null
        }
        const previous = remoteSizeRef.current
        const sizeChanged = previous.cols > 0 && previous.rows > 0 &&
          info.width > 0 && info.height > 0 &&
          (previous.cols !== info.width || previous.rows !== info.height)
        if (info.width > 0 && info.height > 0) {
          remoteSizeRef.current = { cols: info.width, rows: info.height }
        }
        if (info.viewer_resize && info.resize_owner !== undefined) {
          followRemoteGridRef.current = layoutGateActive && layoutReassertResizeRef.current
            ? false
            : !info.resize_owner
        }
        if (layoutGateActive) {
          paneInfoRef.current?.(info)
          return
        }
        const becameObserver = previousOwner === true && info.resize_owner === false
        if ((sizeChanged || becameObserver) && followRemoteGridRef.current) {
          // Discard output produced while tmux was repainting between grids. The
          // next viewport snapshot becomes the sole source of visible state.
          replaceNextSnapshotRef.current = true
          followRemoteGridRef.current = true
          if (term.cols !== info.width || term.rows !== info.height) {
            term.resize(info.width, info.height)
          }
          applyFrameScale()
          ws.requestSnapshot(true)
        } else if (followRemoteGridRef.current) {
          applyFrameScale()
        } else {
          clearFrameScale()
        }
        paneInfoRef.current?.(info)
      },
      onPaneClosed: () => {
        connStatusRef.current?.('disconnected')
        term.write('\r\n\x1b[33m[Pane 已关闭]\x1b[0m\r\n')
        paneClosedRef.current?.()
      },
      onRecoveryStart: () => {
        // Keep the last good frame visible while the channel heals. The next
        // authoritative snapshot replaces it atomically instead of appending a
        // full terminal replay to the existing xterm buffer.
        replaceNextSnapshotRef.current = true
      },
      onInputDropped: (() => {
        let lastToastTime = 0
        return () => {
          const now = Date.now()
          if (now - lastToastTime < 2000) return
          lastToastTime = now
          eventBus.emit('toast:show', { message: '连接已断开，输入未发送', type: 'error', duration: 2000 })
        }
      })(),
    })

    // Input handling
    term.onData((data) => {
      if ((ctrlRef.current || altRef.current) && data.length === 1 && data >= ' ') {
        let out = data
        if (ctrlRef.current) { const c = data.toUpperCase().charCodeAt(0); if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64) }
        if (altRef.current) out = '\x1b' + out
        ws.sendInput(out); modifierUsedRef.current?.(); onInputRef.current?.(out); return
      }
      ws.sendInput(data)
      onInputRef.current?.(data)
    })
    term.onBinary((data) => { ws.sendInput(data); onInputRef.current?.(data) })
    let clipboardReadInFlight = false
    const nativePasteEventGate = createWailsPasteEventGate()
    const pasteNativeClipboard = async () => {
      if (clipboardReadInFlight) return
      clipboardReadInFlight = true
      try {
        const clipboard = await readWailsTerminalClipboard()
        if (clipboard.kind === 'text') {
          term.paste(clipboard.text)
        } else if (clipboard.kind === 'image') {
          const path = pasteClipboardImageRef.current
            ? await pasteClipboardImageRef.current(clipboard.image)
            : clipboard.image.localPath
          if (path) {
            await writeWailsTerminalClipboardText(path)
            term.paste(path)
          }
        }
      } catch {
        eventBus.emit('toast:show', { message: 'Unable to read the clipboard image', type: 'error', duration: 2500 })
      } finally {
        clipboardReadInFlight = false
      }
    }
    const onPaste = (event: ClipboardEvent) => {
      if (!interceptWailsTerminalPaste(event)) return
      if (nativePasteEventGate.consumePasteEvent()) return
      // WKWebView may dispatch a regular paste event even after the custom
      // Command+V handler runs. Own every Wails paste here so xterm never
      // inserts clipboard text a second time; the in-flight guard coalesces
      // the key and paste events into one native clipboard read.
      void pasteNativeClipboard()
    }
    textarea?.addEventListener('paste', onPaste, { capture: true })
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === 'keydown' && isWailsApp() && ev.metaKey && ev.key.toLowerCase() === 'v') {
        nativePasteEventGate.expectPasteEvent()
        void pasteNativeClipboard()
        return false
      }
      if (ev.type !== 'keydown' || (!ctrlRef.current && !altRef.current)) return true
      if (['Control','Alt','Shift','Meta'].includes(ev.key)) return true
      if (ev.key.length === 1) {
        let out = ev.key
        if (ctrlRef.current) { const c = ev.key.toUpperCase().charCodeAt(0); if (c >= 64 && c <= 95) out = String.fromCharCode(c - 64) }
        if (altRef.current) out = '\x1b' + out
        ws.sendInput(out); modifierUsedRef.current?.(); return false
      }
      return true
    })

    if (webrtcTransport) {
      ws.connect(paneId, webrtcTransport)
      prevTransportRef.current = webrtcTransport
    }
    propsRef.current = { paneId, webrtcTransport }
    // 先 connStatus（会重置 termStage），再 stage（设为 dc-creating）
    connStatusRef.current?.('connecting')
    stageRef.current?.('dc-creating')

    // Touch/wheel scroll
    const screenEl = container.querySelector('.xterm-screen') as HTMLElement | null
    const coreTerminal = (term as any)._core
    const getLineHeight = () => Math.ceil((term.element?.clientHeight ?? 0) / term.rows) || 20
    let LINE_HEIGHT_PX = getLineHeight()
    let touchAccum = 0, touchLastX = NaN, touchLastY = NaN
    let touchStartX = NaN, touchStartY = NaN, touchStartTime = 0, touchMoved = false
    let touchPanAxis: 'x' | 'y' | null = null
    // 惯性滚动相关
    let velocityY = 0, lastTouchTime = 0, momentumAnimId = 0

    // ---- 亚行级平滑滚动 ----
    // 思路：CSS translateY 做像素级视觉偏移，scrollLines 做行级数据同步。
    // 关键：transform 的计算基于「实际已渲染的 ydisp」(通过 onRender 获取)，
    //       而不是「请求的 ydisp」(scrollLines 同步更新但画布异步绘制)。
    //       这样画布更新和 CSS 修正在同一帧内完成，不会错位。
    let smoothActive = false
    let totalPxOffset = 0   // 从 baseYdisp 起累计的期望像素偏移
    let baseYdisp = 0       // 滚动开始时的 viewportY
    let renderedYdisp = 0   // xterm 实际渲染到画布上的 viewportY

    // 缓冲区切换时（进入/退出 htop 等全屏程序）清理平滑滚动状态
    const bufChangeDisp = term.buffer.onBufferChange(() => {
      if (momentumAnimId) { cancelAnimationFrame(momentumAnimId); momentumAnimId = 0 }
      smoothEnd()
      bufferChangeRef.current?.(term.buffer.active.type === 'alternate')
    })

    // xterm 画布完成重绘后回调
    const onRenderDisp = term.onRender(() => {
      const y = term.buffer.active.viewportY
      if (y !== renderedYdisp) {
        renderedYdisp = y
        if (smoothActive) syncTransform()
        // 更新滚动条
        sbUpdate()
        sbShow()
        sbHideDelayed()
      }
    })

    // 光标移动时通知外部（用于键盘弹出时动态调整终端偏移）
    const cursorMoveDisp = term.onCursorMove(() => { cursorMoveRef.current?.() })

    const syncTransform = () => {
      if (!screenEl || !smoothActive) return
      const renderedPx = (renderedYdisp - baseYdisp) * LINE_HEIGHT_PX
      const sub = totalPxOffset - renderedPx
      screenEl.style.transform = `translateY(${-sub}px)`
    }

    const smoothBegin = () => {
      if (smoothActive) return
      smoothActive = true
      baseYdisp = term.buffer.active.viewportY
      renderedYdisp = baseYdisp
      totalPxOffset = 0
      if (screenEl) screenEl.style.willChange = 'transform'
    }

    const smoothEnd = () => {
      if (!smoothActive) return
      if (screenEl) {
        screenEl.style.transform = ''
        screenEl.style.willChange = ''
      }
      smoothActive = false
    }

    /** 像素级滚动，返回 true 表示到达边界 */
    const scrollPx = (px: number): boolean => {
      totalPxOffset += px
      const desiredYdisp = baseYdisp + Math.trunc(totalPxOffset / LINE_HEIGHT_PX)
      const curYdisp = term.buffer.active.viewportY
      let clamped = false
      if (desiredYdisp !== curYdisp) {
        term.scrollLines(desiredYdisp - curYdisp)
        const actual = term.buffer.active.viewportY
        if (actual !== desiredYdisp) {
          // 到顶或到底，xterm 做了 clamp
          totalPxOffset = (actual - baseYdisp) * LINE_HEIGHT_PX
          clamped = true
        }
      }
      syncTransform()
      return clamped
    }

    const isMM = () => { try { return coreTerminal?.coreMouseService?.areMouseEventsActive ?? false } catch { return false } }
    const isAlt = () => frameApplicationMode || term.buffer.active.type === 'alternate'
    const isApp = () => { try { return coreTerminal?.coreService?.decPrivateModes?.applicationCursorKeys ?? false } catch { return false } }

    const sendScroll = (down: boolean) => {
      if (isMM()) {
        // 分发合成 wheel 事件，让 xterm 内部按当前鼠标协议编码生成正确的滚轮事件
        if (screenEl) {
          const rect = screenEl.getBoundingClientRect()
          screenEl.dispatchEvent(new WheelEvent('wheel', {
            deltaY: down ? 1 : -1,
            deltaMode: 1, // DOM_DELTA_LINE
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            bubbles: true,
            cancelable: true,
          }))
        }
      } else {
        const a = isApp()
        ws.sendInput(down ? (a ? '\x1bOB' : '\x1b[B') : (a ? '\x1bOA' : '\x1b[A'))
      }
    }

    // 不注册自定义 wheel handler，让 xterm 原生处理所有滚轮事件：
    // - 鼠标模式：xterm 自动转换为 mouse button 64/65 事件，使用正确的编码和坐标
    // - 替代缓冲区无鼠标：xterm 自动转换为方向键
    // - 普通缓冲区：xterm 处理 scrollback 滚动

    // 选择模式：将触摸坐标转换为 xterm buffer 行列位置
    let selAnchorCol = 0, selAnchorRow = 0  // 当前锚点（下次选区的起点）
    let selEndCol = 0, selEndRow = 0
    let selTouchActive = false
    let selModeWasActive = false
    let selAutoScrollId: ReturnType<typeof setInterval> | null = null
    let selLastClientX = 0, selLastClientY = 0
    // idle: 无锚点 → 点击设锚 → anchor-set
    // anchor-set: 有锚点 → 点击创建选区(锚→点击位置)，点击位置变新锚 → 仍 anchor-set
    let selPhase: 'idle' | 'anchor-set' = 'idle'
    // extending: touchstart 创建选区后拖拽可微调终点
    let selExtending = false
    const touchToBufferPos = (clientX: number, clientY: number) => {
      const el = screenEl || container
      const rect = el.getBoundingClientRect()
      const cellWidth = rect.width / term.cols
      const col = Math.max(0, Math.min(term.cols - 1, Math.floor((clientX - rect.left) / cellWidth)))
      const row = Math.floor((clientY - rect.top) / LINE_HEIGHT_PX)
      const bufRow = Math.max(0, Math.min(term.buffer.active.length - 1, row + term.buffer.active.viewportY))
      return { col, row: bufRow }
    }

    /** 初始化滚动状态（选择模式切到双指滚动时复用） */
    const initScrollState = (e: TouchEvent) => {
      if (momentumAnimId) { cancelAnimationFrame(momentumAnimId); momentumAnimId = 0 }
      smoothEnd()
      let sx=0, sy=0; for(let i=0;i<e.touches.length;i++) { sx+=e.touches[i].clientX; sy+=e.touches[i].clientY }
      touchLastX=sx/e.touches.length; touchLastY=sy/e.touches.length; touchAccum=0
      touchStartX=touchLastX; touchStartY=touchLastY; touchStartTime=Date.now(); touchMoved=false
      touchPanAxis=null
      velocityY=0; lastTouchTime=Date.now()
    }

    /** 从 anchor 到 end 应用选区 */
    const applySelection = () => {
      let r1 = selAnchorRow, c1 = selAnchorCol
      let r2 = selEndRow, c2 = selEndCol
      if (r1 > r2 || (r1 === r2 && c1 > c2)) {
        ;[r1, c1, r2, c2] = [r2, c2, r1, c1]
      }
      const length = (r2 - r1) * term.cols + (c2 - c1) + 1
      term.select(c1, r1, length)
    }

    const stopSelAutoScroll = () => {
      if (selAutoScrollId) { clearInterval(selAutoScrollId); selAutoScrollId = null }
    }

    /** 手指靠近终端上下边缘时自动滚动 */
    const checkSelAutoScroll = (clientY: number) => {
      const el = screenEl || container
      const rect = el.getBoundingClientRect()
      const zone = 40
      const atTop = clientY < rect.top + zone
      const atBottom = clientY > rect.bottom - zone
      if (!atTop && !atBottom) { stopSelAutoScroll(); return }
      if (selAutoScrollId) return
      selAutoScrollId = setInterval(() => {
        term.scrollLines(atBottom ? 1 : -1)
        if (selExtending) {
          const pos = touchToBufferPos(selLastClientX, selLastClientY)
          selEndCol = pos.col; selEndRow = pos.row
          applySelection()
        }
      }, 80)
    }

    // ---- 滚动条 ----
    const scrollbarTrack = document.createElement('div')
    scrollbarTrack.className = 'term-scrollbar-track'
    const scrollbarThumb = document.createElement('div')
    scrollbarThumb.className = 'term-scrollbar-thumb'
    scrollbarTrack.appendChild(scrollbarThumb)
    container.appendChild(scrollbarTrack)

    let sbHideTimer = 0
    let sbDragging = false
    let sbDragStartY = 0        // touch 起始 clientY
    let sbDragStartRatio = 0    // drag 开始时的 scrollRatio

    const sbShow = () => {
      scrollbarTrack.classList.add('visible')
      clearTimeout(sbHideTimer)
    }
    const sbHideDelayed = () => {
      clearTimeout(sbHideTimer)
      if (sbDragging) return
      sbHideTimer = window.setTimeout(() => {
        scrollbarTrack.classList.remove('visible')
      }, 1200)
    }
    const sbUpdate = () => {
      const buf = term.buffer.active
      const totalLines = buf.length
      const viewportRows = term.rows
      if (totalLines <= viewportRows) {
        scrollbarTrack.classList.remove('visible')
        return
      }
      const maxScroll = totalLines - viewportRows
      const ratio = buf.viewportY / maxScroll
      const thumbRatio = Math.max(0.06, viewportRows / totalLines)
      const trackH = scrollbarTrack.clientHeight
      const thumbH = Math.max(24, trackH * thumbRatio)
      const thumbTop = ratio * (trackH - thumbH)
      scrollbarThumb.style.height = `${thumbH}px`
      scrollbarThumb.style.transform = `translateY(${thumbTop}px)`
    }

    // 拖拽 scrollbar thumb
    const sbTouchStart = (e: TouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
      sbDragging = true
      scrollbarTrack.classList.add('active')
      sbShow()
      const touch = e.touches[0]
      sbDragStartY = touch.clientY
      const buf = term.buffer.active
      const maxScroll = buf.length - term.rows
      sbDragStartRatio = maxScroll > 0 ? buf.viewportY / maxScroll : 0
    }
    const sbTouchMove = (e: TouchEvent) => {
      if (!sbDragging) return
      e.preventDefault()
      e.stopPropagation()
      const touch = e.touches[0]
      const trackH = scrollbarTrack.clientHeight
      const thumbH = scrollbarThumb.clientHeight
      const dy = touch.clientY - sbDragStartY
      const scrollableTrack = trackH - thumbH
      if (scrollableTrack <= 0) return
      const deltaRatio = dy / scrollableTrack
      const newRatio = Math.max(0, Math.min(1, sbDragStartRatio + deltaRatio))
      const buf = term.buffer.active
      const maxScroll = buf.length - term.rows
      const targetY = Math.round(newRatio * maxScroll)
      const diff = targetY - buf.viewportY
      if (diff !== 0) term.scrollLines(diff)
      sbUpdate()
    }
    const sbTouchEnd = (e: TouchEvent) => {
      e.preventDefault()
      sbDragging = false
      scrollbarTrack.classList.remove('active')
      sbHideDelayed()
    }
    // 点击 track 跳转到对应位置
    const sbTrackTap = (e: TouchEvent) => {
      if (e.target !== scrollbarTrack) return
      e.preventDefault()
      e.stopPropagation()
      const touch = e.touches[0]
      const rect = scrollbarTrack.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (touch.clientY - rect.top) / rect.height))
      const buf = term.buffer.active
      const maxScroll = buf.length - term.rows
      const targetY = Math.round(ratio * maxScroll)
      const diff = targetY - buf.viewportY
      if (diff !== 0) term.scrollLines(diff)
      sbUpdate()
      // 之后转入拖拽模式
      sbDragging = true
      scrollbarTrack.classList.add('active')
      sbShow()
      sbDragStartY = touch.clientY
      sbDragStartRatio = maxScroll > 0 ? buf.viewportY / maxScroll : 0
    }

    scrollbarThumb.addEventListener('touchstart', sbTouchStart, { passive: false })
    scrollbarTrack.addEventListener('touchstart', sbTrackTap, { passive: false })
    document.addEventListener('touchmove', sbTouchMove, { passive: false })
    document.addEventListener('touchend', sbTouchEnd, { passive: true })
    document.addEventListener('touchcancel', sbTouchEnd, { passive: true })

    let wheelRemainder = 0
    if (desktopSurface) {
      term.attachCustomWheelEventHandler(event => {
        if (followRemoteGridRef.current && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
          container.scrollLeft += event.deltaX
          event.preventDefault()
          return false
        }
        if (event.shiftKey || event.ctrlKey || isMM() || isAlt()) {
          wheelRemainder = 0
          return true
        }
        if (term.buffer.active.length <= term.rows) {
          wheelRemainder = 0
          return true
        }

        const normalized = normalizeTerminalWheel({
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          lineHeight: getLineHeight(),
          viewportRows: term.rows,
          remainder: wheelRemainder,
          maxLines: event.altKey ? TERMINAL_WHEEL_FAST_MAX_LINES : TERMINAL_WHEEL_MAX_LINES,
        })
        wheelRemainder = normalized.remainder
        event.preventDefault()
        if (normalized.lines !== 0) {
          term.scrollLines(normalized.lines)
          sbUpdate()
          sbShow()
          sbHideDelayed()
        }
        return false
      })
    }

    // ---- 放大镜 + 锚点标记 DOM ----
    const magnifierEl = document.createElement('div')
    magnifierEl.className = 'sel-magnifier'
    const magCanvas = document.createElement('canvas')
    const MAG_W = 160, MAG_H = 60
    magCanvas.width = MAG_W * devicePixelRatio
    magCanvas.height = MAG_H * devicePixelRatio
    magCanvas.style.width = `${MAG_W}px`
    magCanvas.style.height = `${MAG_H}px`
    magCanvas.style.display = 'block'
    magnifierEl.appendChild(magCanvas)
    container.appendChild(magnifierEl)

    const anchorMarkerEl = document.createElement('div')
    anchorMarkerEl.className = 'sel-anchor-marker'
    container.appendChild(anchorMarkerEl)

    const showAnchorMarker = (col: number, row: number) => {
      const el = screenEl || container
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const cellWidth = rect.width / term.cols
      const viewportRow = row - term.buffer.active.viewportY
      const x = rect.left - containerRect.left + col * cellWidth
      const y = rect.top - containerRect.top + viewportRow * LINE_HEIGHT_PX
      anchorMarkerEl.style.left = `${x}px`
      anchorMarkerEl.style.top = `${y}px`
      anchorMarkerEl.style.height = `${LINE_HEIGHT_PX}px`
      anchorMarkerEl.style.display = 'block'
    }

    const hideAnchorMarker = () => { anchorMarkerEl.style.display = 'none' }

    /** 放大镜：基于 cell 坐标采样，避免 client 坐标偏差 */
    const updateMagnifierForCell = (col: number, bufRow: number, clientX: number, clientY: number) => {
      const canvases = container.querySelectorAll('.xterm-screen canvas') as NodeListOf<HTMLCanvasElement>
      if (canvases.length === 0) return
      const magCtx = magCanvas.getContext('2d')
      if (!magCtx) return

      const refCanvas = canvases[0]
      // 直接从 cell 坐标算 canvas 像素位置，完全绕过 getBoundingClientRect
      const viewRow = bufRow - term.buffer.active.viewportY
      const cx = (col + 0.5) / term.cols * refCanvas.width
      const cy = (viewRow + 0.5) / term.rows * refCanvas.height
      // 2x 放大
      const scaleX = refCanvas.width / (screenEl || container).getBoundingClientRect().width
      const scaleY = refCanvas.height / (screenEl || container).getBoundingClientRect().height
      const sw = MAG_W * scaleX / 2
      const sh = MAG_H * scaleY / 2

      magCtx.clearRect(0, 0, magCanvas.width, magCanvas.height)
      magCtx.fillStyle = '#000'
      magCtx.fillRect(0, 0, magCanvas.width, magCanvas.height)
      for (const canvas of canvases) {
        try {
          magCtx.drawImage(canvas, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, magCanvas.width, magCanvas.height)
        } catch { /* skip */ }
      }

      // 十字准线
      magCtx.strokeStyle = 'rgba(255,255,255,0.5)'
      magCtx.lineWidth = 1
      const midX = magCanvas.width / 2, midY = magCanvas.height / 2
      magCtx.beginPath()
      magCtx.moveTo(midX, 0); magCtx.lineTo(midX, magCanvas.height)
      magCtx.moveTo(0, midY); magCtx.lineTo(magCanvas.width, midY)
      magCtx.stroke()

      // 定位：手指正上方
      const containerRect = container.getBoundingClientRect()
      let magX = clientX - containerRect.left - MAG_W / 2
      let magY = clientY - containerRect.top - 70 - MAG_H
      if (magX < 4) magX = 4
      if (magX + MAG_W > containerRect.width - 4) magX = containerRect.width - MAG_W - 4
      if (magY < 4) magY = clientY - containerRect.top + 30
      magnifierEl.style.left = `${magX}px`
      magnifierEl.style.top = `${magY}px`
      magnifierEl.style.display = 'block'
    }

    const hideMagnifier = () => { magnifierEl.style.display = 'none' }

    const resetSelState = () => {
      selPhase = 'idle'
      selExtending = false
      selTouchActive = false
      stopSelAutoScroll()
      hideAnchorMarker()
      hideMagnifier()
    }

    const onTS = (e: TouchEvent) => {
      if (e.touches.length >= 1) {
        // 选择模式进出时重置状态
        if (selectionModeRef.current && !selModeWasActive) {
          resetSelState(); selModeWasActive = true
        }
        if (!selectionModeRef.current && selModeWasActive) {
          resetSelState(); selModeWasActive = false
        }
        // 选择模式 + 单指
        if (selectionModeRef.current && e.touches.length === 1) {
          e.preventDefault()
          e.stopPropagation()
          selTouchActive = true
          selExtending = false
          const touch = e.touches[0]
          const pos = touchToBufferPos(touch.clientX, touch.clientY)

          if (selPhase === 'idle') {
            // 首次点击：设锚点
            term.clearSelection()
            selAnchorCol = pos.col
            selAnchorRow = pos.row
            selPhase = 'anchor-set'
            showAnchorMarker(pos.col, pos.row)
            updateMagnifierForCell(pos.col, pos.row, touch.clientX, touch.clientY)
          } else if (selPhase === 'anchor-set') {
            // 后续点击：创建选区(锚→点击位置)，拖拽可微调终点
            selEndCol = pos.col
            selEndRow = pos.row
            selExtending = true
            applySelection()
            hideAnchorMarker()
            updateMagnifierForCell(pos.col, pos.row, touch.clientX, touch.clientY)
          }
          return
        }
        // 选择模式 + 多指 → 双指滚动（保留选区和锚点状态）
        if (selectionModeRef.current && e.touches.length >= 2) {
          selTouchActive = false
          selExtending = false
          stopSelAutoScroll()
          hideMagnifier()
          initScrollState(e)
          e.preventDefault()
          e.stopPropagation()
          return
        }
        // 非选择模式：正常滚动初始化
        initScrollState(e)
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onTM = (e: TouchEvent) => {
      if (e.touches.length < 1) return

      if (selectionModeRef.current) {
        e.preventDefault()
        e.stopPropagation()

        // 双指加入 → 从选择切换为滚动（保留选区和锚点）
        if (e.touches.length >= 2 && selTouchActive) {
          selTouchActive = false
          selExtending = false
          stopSelAutoScroll()
          hideMagnifier()
          let sy = 0; for (let i = 0; i < e.touches.length; i++) sy += e.touches[i].clientY
          touchLastY = sy / e.touches.length
          touchAccum = 0; velocityY = 0; lastTouchTime = Date.now()
          touchMoved = false; touchStartY = touchLastY; touchStartTime = Date.now()
        }

        // 单指拖拽
        if (selTouchActive && e.touches.length === 1) {
          const touch = e.touches[0]
          selLastClientX = touch.clientX
          selLastClientY = touch.clientY
          const pos = touchToBufferPos(touch.clientX, touch.clientY)

          if (selExtending) {
            // 创建选区后拖拽：微调终点
            selEndCol = pos.col
            selEndRow = pos.row
            applySelection()
            updateMagnifierForCell(pos.col, pos.row, touch.clientX, touch.clientY)
            checkSelAutoScroll(touch.clientY)
          } else {
            // anchor-set 首次点击拖拽：锚点跟随手指
            selAnchorCol = pos.col
            selAnchorRow = pos.row
            showAnchorMarker(pos.col, pos.row)
            updateMagnifierForCell(pos.col, pos.row, touch.clientX, touch.clientY)
          }
          return
        }

        // 双指滚动（选择模式内）— 不清除选区
        if (!selTouchActive && e.touches.length >= 2) {
          let s=0; for(let i=0;i<e.touches.length;i++) s+=e.touches[i].clientY; const y=s/e.touches.length
          if (isNaN(touchLastY)) { touchLastY=y; lastTouchTime=Date.now(); return }
          if (Math.abs(y - touchStartY) > 10) touchMoved = true
          const now = Date.now()
          const dt = now - lastTouchTime
          const dy = touchLastY - y
          if (dt > 0) { velocityY = velocityY * 0.3 + (dy / dt * 1000) * 0.7 }
          lastTouchTime = now; touchLastY = y
          smoothBegin(); scrollPx(dy)
          return
        }
        return
      }

      // 非选择模式：正常滚动
      e.preventDefault()
      e.stopPropagation()
      let sx=0, sy=0
      for(let i=0;i<e.touches.length;i++) { sx+=e.touches[i].clientX; sy+=e.touches[i].clientY }
      const x=sx/e.touches.length, y=sy/e.touches.length
      if (isNaN(touchLastY) || isNaN(touchLastX)) { touchLastX=x; touchLastY=y; lastTouchTime=Date.now(); return }
      const moveX = touchLastX - x
      if (followRemoteGridRef.current) {
        const totalX = Math.abs(x - touchStartX)
        const totalY = Math.abs(y - touchStartY)
        if (!touchPanAxis && Math.max(totalX, totalY) > 4) touchPanAxis = totalX > totalY ? 'x' : 'y'
        if (touchPanAxis === 'x') {
          if (totalX > 10) touchMoved = true
          container.scrollLeft += moveX
          touchLastX = x
          touchLastY = y
          velocityY = 0
          return
        }
      }
      if (Math.abs(y - touchStartY) > 10) touchMoved = true

      const now = Date.now()
      const dt = now - lastTouchTime
      const dy = touchLastY - y // 正值 = 手指向上 = 内容向下滚

      // 用指数移动平均计算速度 (px/s)
      if (dt > 0) {
        const instantV = dy / dt * 1000
        velocityY = velocityY * 0.3 + instantV * 0.7
      }
      lastTouchTime = now
      touchLastX = x
      touchLastY = y

      if (isMM() || isAlt()) {
        if (smoothActive) smoothEnd()
        touchAccum += dy
        const lines = Math.trunc(touchAccum / LINE_HEIGHT_PX)
        if (lines !== 0) {
          touchAccum -= lines * LINE_HEIGHT_PX
          for (let i = 0; i < Math.abs(lines); i++) sendScroll(lines > 0)
        }
      } else {
        smoothBegin()
        scrollPx(dy)
      }
    }
    const onTE = () => {
      // 选择模式下
      if (selectionModeRef.current) {
        if (selTouchActive) {
          selTouchActive = false
          stopSelAutoScroll()
          hideMagnifier()
          if (selExtending) {
            // 选区创建完成，点击位置变新锚，保持 anchor-set 等待下一次点击
            selAnchorCol = selEndCol
            selAnchorRow = selEndRow
            selExtending = false
            // selPhase 保持 anchor-set，下次点击继续链式选择
          }
          // anchor-set 首次点击抬起：保持锚点标记等待第二次点击
          return
        }
        // 双指滚动结束 — 选区和锚点状态不变
        smoothEnd()
        touchLastY = NaN
        return
      }
      // 短按且没有明显移动 -> 视为点击
      if (!touchMoved && Date.now() - touchStartTime < 500) {
        if (isMM() && screenEl) {
          // 分发合成鼠标事件，让 xterm 内部处理坐标转换和协议编码
          // 这样无论应用使用 SGR/Normal/URXVT 哪种鼠标模式都能正确处理
          const mouseOpts: MouseEventInit = {
            clientX: touchStartX,
            clientY: touchStartY,
            button: 0,
            bubbles: true,
            cancelable: true,
          }
          screenEl.dispatchEvent(new MouseEvent('mousedown', { ...mouseOpts, buttons: 1 }))
          screenEl.dispatchEvent(new MouseEvent('mouseup', { ...mouseOpts, buttons: 0 }))
        }
        if (!preventFocusRef.current) textarea?.focus()
        velocityY = 0
        smoothEnd()
      } else if (Math.abs(velocityY) > 80) {
        if (Date.now() - lastTouchTime > 80) { velocityY = 0; smoothEnd() }
        else {
          let lastFrameTime = performance.now()
          const DECEL = 0.97
          const MIN_V = 80

          const step = (now: number) => {
            const frameDt = (now - lastFrameTime) / 1000
            lastFrameTime = now
            velocityY *= Math.pow(DECEL, frameDt * 60)

            if (Math.abs(velocityY) < MIN_V) {
              momentumAnimId = 0; smoothEnd(); return
            }

            const pixelDelta = velocityY * frameDt
            if (isMM() || isAlt()) {
              // 从普通缓冲区进入替代缓冲区时，清理平滑滚动的 CSS transform
              if (smoothActive) smoothEnd()
              touchAccum += pixelDelta
              const lines = Math.trunc(touchAccum / LINE_HEIGHT_PX)
              if (lines !== 0) {
                touchAccum -= lines * LINE_HEIGHT_PX
                for (let i = 0; i < Math.abs(lines); i++) sendScroll(lines > 0)
              }
            } else {
              if (scrollPx(pixelDelta)) {
                momentumAnimId = 0; smoothEnd(); return
              }
            }
            momentumAnimId = requestAnimationFrame(step)
          }
          touchAccum = 0
          momentumAnimId = requestAnimationFrame(step)
        }
      } else {
        smoothEnd()
      }
      touchLastX = NaN
      touchLastY = NaN
    }

    const tt = screenEl || container
    tt.addEventListener('touchstart', onTS, { passive: false })
    tt.addEventListener('touchmove', onTM, { passive: false })
    tt.addEventListener('touchend', onTE, { passive: true })
    tt.addEventListener('touchcancel', onTE, { passive: true })

    // 监听主题切换，动态更新 xterm 配色
    const onThemeChange = (e: Event) => {
      const theme = (e as CustomEvent<ThemeDefinition>).detail
      activeTheme = theme
      term.options.theme = resolvedTerminalTheme(theme)
    }
    const onDesktopSettingsChange = (e: Event) => {
      if (!desktopSurface) return
      desktopBackgroundOpacity = (e as CustomEvent<DesktopSettings>).detail.appearance.windowOpacity
      term.options.theme = resolvedTerminalTheme(activeTheme)
    }
    const onTerminalSettingsChange = (e: Event) => {
      const settings = (e as CustomEvent<TerminalSettings>).detail
      configuredScrollbackRef.current = settings.scrollback
      configuredCursorBlinkRef.current = settings.cursorBlink
      term.options.fontSize = settings.fontSize
      term.options.fontFamily = settings.fontFamily
      if (!suspendedRef.current) {
        term.options.scrollback = settings.scrollback
        term.options.cursorBlink = settings.cursorBlink
      }
      requestAnimationFrame(() => {
        try {
          if (followRemoteGridRef.current) applyFrameScale()
          else fitAddon.fit()
        } catch {}
      })
    }
    const onWindowBlur = () => {
      windowActiveRef.current = false
      if (followRemoteGridRef.current) requestAnimationFrame(applyFrameScale)
    }
    const onWindowFocus = () => {
      windowActiveRef.current = true
    }
    window.addEventListener('tgent-theme-change', onThemeChange)
    window.addEventListener('tgent-desktop-settings-change', onDesktopSettingsChange)
    window.addEventListener('tgent-terminal-settings-change', onTerminalSettingsChange)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)

    termRef.current = term
    clientRef.current = ws

    cleanupRef.current = () => {
      window.removeEventListener('tgent-theme-change', onThemeChange)
      window.removeEventListener('tgent-desktop-settings-change', onDesktopSettingsChange)
      window.removeEventListener('tgent-terminal-settings-change', onTerminalSettingsChange)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      if (momentumAnimId) cancelAnimationFrame(momentumAnimId)
      smoothEnd()
      stopSelAutoScroll()
      bufChangeDisp.dispose()
      onRenderDisp.dispose()
      cursorMoveDisp.dispose()
      textarea?.removeEventListener('focus', onFocus)
      textarea?.removeEventListener('compositionstart', onCompStart)
      textarea?.removeEventListener('compositionupdate', onCompUpdate)
      textarea?.removeEventListener('compositionend', onCompEnd)
      cancelAnimationFrame(compositionFrame)
      textarea?.removeEventListener('paste', onPaste, { capture: true })
      compOverlay.remove()
      magnifierEl.remove()
      anchorMarkerEl.remove()
      scrollbarThumb.removeEventListener('touchstart', sbTouchStart)
      scrollbarTrack.removeEventListener('touchstart', sbTrackTap)
      document.removeEventListener('touchmove', sbTouchMove)
      document.removeEventListener('touchend', sbTouchEnd)
      document.removeEventListener('touchcancel', sbTouchEnd)
      clearTimeout(sbHideTimer)
      scrollbarTrack.remove()
      tt.removeEventListener('touchstart', onTS)
      tt.removeEventListener('touchmove', onTM)
      tt.removeEventListener('touchend', onTE)
      tt.removeEventListener('touchcancel', onTE)
      clearTimeout(resizeDebounce)
      clearTimeout(layoutSettleTimer)
      clearTimeout(layoutSnapshotTimer)
      clearTimeout(layoutSnapshotFallbackTimer)
      clearTimeout(initialSurfacePulseTimer)
      clearTimeout(surfacePulseReleaseTimer)
      clearTimeout(surfaceFinalSnapshotTimer)
      surfacePulseActiveRef.current = false
      layoutSettlingRef.current = false
      layoutAwaitingSnapshotRef.current = false
      layoutExpectedSizeRef.current = null
      layoutReassertResizeRef.current = false
      prepareLayoutChangeRef.current = () => {}
      suspendRenderer()
      suspendRendererRef.current = () => {}
      resumeRendererRef.current = () => {}
      frameResetRef.current = () => {}
      frameGridRef.current = false
      frameViewerResizeRef.current = false
      resizeOwnerRef.current = null
      followRemoteGridRef.current = false
      takeResizeControlRef.current = () => {}
      frameScaleRef.current = () => {}
      clearFrameScale()
      resizeObserver?.disconnect()
      if (!resizeObserver) window.removeEventListener('resize', handleResize)
      ws.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
      clientRef.current = null
    }

    })() // end async IIFE

    return () => {
      disposed = true
      if (viewportSyncTimerRef.current) {
        clearTimeout(viewportSyncTimerRef.current)
        viewportSyncTimerRef.current = null
      }
      if (viewportSyncReleaseTimerRef.current) {
        clearTimeout(viewportSyncReleaseTimerRef.current)
        viewportSyncReleaseTimerRef.current = null
      }
      viewportSyncInFlightRef.current = false
      suspendedDirtyRef.current = false
      replaceNextSnapshotRef.current = false
      cleanupRef.current?.()
    }
  }, [paneId])

  // transport 变化时自动 rebind（不卸载 xterm）
  useEffect(() => {
    const client = clientRef.current
    if (!client || !webrtcTransport) return
    if (webrtcTransport === prevTransportRef.current) return
    prevTransportRef.current = webrtcTransport
    propsRef.current = { paneId, webrtcTransport }
    // 先通知 overlay 显示（flushSync 同步渲染），再清屏，避免清屏瞬间暴露空白终端
    connStatusRef.current?.('connecting')
    stageRef.current?.('dc-creating')
    const term = termRef.current
    if (term) { term.clear(); term.reset() }
    frameResetRef.current()
    client.rebind(webrtcTransport)
  }, [webrtcTransport, paneId])

  return <div ref={containerRef} className="tgent-terminal-viewport w-full h-full" style={{ backgroundColor: 'var(--terminal-surface-background, var(--color-term-bg))' }} />
}))
