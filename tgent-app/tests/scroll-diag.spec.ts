import { test, expect, devices } from '@playwright/test'

const OC_PANE_ID = '%18'
const TERMINAL_URL = `/terminal/${encodeURIComponent(OC_PANE_ID)}`

function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test.describe('Scroll diagnostics for opencode', () => {

  test('check terminal state and mouse mode', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
    const page = await ctx.newPage()

    // Collect all console messages
    const logs: string[] = []
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`))

    await page.goto(TERMINAL_URL)
    await waitMs(3000)

    // Inspect xterm.js internal state
    const state = await page.evaluate(() => {
      const xtermEl = document.querySelector('.xterm')
      const vp = document.querySelector('.xterm-viewport') as HTMLElement
      const screen = document.querySelector('.xterm-screen') as HTMLElement

      // Try to access xterm.js internals via the DOM
      // xterm.js stores the Terminal instance on the element
      let mouseMode = 'unknown'
      let altBuffer = 'unknown'
      let hasScrollback = 'unknown'

      // Walk up to find the terminal instance
      const allElements = document.querySelectorAll('*')
      for (const el of allElements) {
        const anyEl = el as any
        if (anyEl._core) {
          mouseMode = String(anyEl._core.coreMouseService?.areMouseEventsActive ?? 'not found')
          altBuffer = String(anyEl._core.buffers?.active === anyEl._core.buffers?.alt ?? 'not found')
          hasScrollback = String(anyEl._core.buffer?.hasScrollback ?? 'not found')
          break
        }
      }

      return {
        mouseMode,
        altBuffer,
        hasScrollback,
        vpScrollTop: vp?.scrollTop,
        vpScrollHeight: vp?.scrollHeight,
        vpClientHeight: vp?.clientHeight,
        screenSize: screen ? `${screen.offsetWidth}x${screen.offsetHeight}` : 'not found',
        xtermClasses: xtermEl?.className ?? 'not found',
        // Check for focus class which indicates mouse tracking
        hasFocusClass: xtermEl?.classList.contains('focus') ?? false,
      }
    })

    console.log('Terminal state:', JSON.stringify(state, null, 2))

    // Now test: dispatch a wheel event directly and see if xterm processes it
    const beforeContent = await page.evaluate(() => {
      const canvas = document.querySelector('.xterm-screen canvas') as HTMLCanvasElement
      return canvas?.toDataURL('image/png').slice(0, 100) ?? 'no canvas'
    })

    // Try dispatching wheel event directly on the xterm-screen element
    await page.evaluate(() => {
      const screen = document.querySelector('.xterm-screen')
      if (!screen) return
      const ev = new WheelEvent('wheel', {
        deltaY: 120,
        deltaMode: 0,
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 400,
      })
      screen.dispatchEvent(ev)
    })
    await waitMs(500)

    // Try dispatching multiple wheel events
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        const screen = document.querySelector('.xterm-screen')
        if (!screen) return
        screen.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 120, deltaMode: 0, bubbles: true, cancelable: true,
          clientX: 200, clientY: 400,
        }))
      })
      await waitMs(100)
    }
    await waitMs(1000)

    const afterContent = await page.evaluate(() => {
      const canvas = document.querySelector('.xterm-screen canvas') as HTMLCanvasElement
      return canvas?.toDataURL('image/png').slice(0, 100) ?? 'no canvas'
    })

    console.log('Canvas changed after wheel:', beforeContent !== afterContent)

    // Also try sending arrow keys directly to see if opencode responds
    const beforeArrow = await page.screenshot({ path: 'tests/screenshots/before-arrow.png' })
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await waitMs(1000)
    const afterArrow = await page.screenshot({ path: 'tests/screenshots/after-arrow.png' })

    console.log('Console logs:', logs.join('\n'))

    await ctx.close()
  })

  test('mobile touch: check if touch events reach xterm', async ({ browser }) => {
    const iPhone = devices['iPhone 13']
    const ctx = await browser.newContext({ ...iPhone })
    const page = await ctx.newPage()
    await page.goto(TERMINAL_URL)
    await waitMs(3000)

    // Check if xterm.js has touch handlers and what they do
    const touchState = await page.evaluate(() => {
      const screen = document.querySelector('.xterm-screen')
      const vp = document.querySelector('.xterm-viewport') as HTMLElement

      // Check touch-action CSS
      const screenStyle = screen ? getComputedStyle(screen) : null
      const vpStyle = vp ? getComputedStyle(vp) : null

      return {
        screenTouchAction: screenStyle?.touchAction ?? 'not found',
        vpTouchAction: vpStyle?.touchAction ?? 'not found',
        vpOverflow: vpStyle?.overflowY ?? 'not found',
        vpScrollHeight: vp?.scrollHeight,
        vpClientHeight: vp?.clientHeight,
      }
    })

    console.log('Mobile touch state:', JSON.stringify(touchState, null, 2))

    await page.screenshot({ path: 'tests/screenshots/mobile-opencode.png' })

    await ctx.close()
  })
})
