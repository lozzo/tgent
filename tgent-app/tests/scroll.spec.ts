import { test, expect, devices } from '@playwright/test'

const OC_PANE_ID = '%18'
const TERMINAL_URL = `/terminal/${encodeURIComponent(OC_PANE_ID)}`

function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test.describe('Terminal scroll behavior', () => {

  test('desktop: wheel scroll in opencode', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 800 },
    })
    const page = await ctx.newPage()
    await page.goto(TERMINAL_URL)
    await waitMs(3000)

    // Take screenshot before scroll
    await page.screenshot({ path: 'tests/screenshots/desktop-before-scroll.png' })

    // Find the terminal area and scroll
    const terminal = page.locator('.xterm-screen')
    const box = await terminal.boundingBox()
    expect(box).not.toBeNull()

    // Scroll down with wheel events
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel(0, 120)
      await waitMs(100)
    }
    await waitMs(1000)

    // Take screenshot after scroll
    await page.screenshot({ path: 'tests/screenshots/desktop-after-scroll.png' })

    // Check if viewport or content changed
    const scrollInfo = await page.evaluate(() => {
      const vp = document.querySelector('.xterm-viewport') as HTMLElement
      return {
        scrollTop: vp?.scrollTop ?? -1,
        scrollHeight: vp?.scrollHeight ?? -1,
        clientHeight: vp?.clientHeight ?? -1,
        hasScrollback: vp?.scrollHeight > vp?.clientHeight,
      }
    })
    console.log('Desktop scroll info:', JSON.stringify(scrollInfo))

    await ctx.close()
  })

  test('mobile: touch scroll in opencode', async ({ browser }) => {
    const iPhone = devices['iPhone 13']
    const ctx = await browser.newContext({
      ...iPhone,
    })
    const page = await ctx.newPage()
    await page.goto(TERMINAL_URL)
    await waitMs(3000)

    await page.screenshot({ path: 'tests/screenshots/mobile-before-scroll.png' })

    const terminal = page.locator('.xterm-screen')
    const box = await terminal.boundingBox()
    expect(box).not.toBeNull()

    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // Simulate two-finger touch scroll (swipe up to scroll down)
    // Playwright doesn't have native multi-touch, so simulate with touchscreen
    await page.touchscreen.tap(cx, cy)
    await waitMs(200)

    // Single finger swipe up (scroll down)
    for (let i = 0; i < 3; i++) {
      const startY = cy + 100
      const endY = cy - 100
      await page.evaluate(({ x, startY, endY }) => {
        const el = document.querySelector('.xterm-screen') || document.querySelector('.xterm-viewport')
        if (!el) return
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: startY })
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], changedTouches: [touch], bubbles: true }))
        const steps = 10
        for (let s = 0; s <= steps; s++) {
          const y = startY + (endY - startY) * (s / steps)
          const moveTouch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
          el.dispatchEvent(new TouchEvent('touchmove', { touches: [moveTouch], changedTouches: [moveTouch], bubbles: true }))
        }
        const endTouch = new Touch({ identifier: 1, target: el, clientX: x, clientY: endY })
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [endTouch], bubbles: true }))
      }, { x: cx, startY: cy + 100, endY: cy - 100 })
      await waitMs(300)
    }

    await waitMs(1000)
    await page.screenshot({ path: 'tests/screenshots/mobile-after-scroll.png' })

    // Check scroll state
    const scrollInfo = await page.evaluate(() => {
      const vp = document.querySelector('.xterm-viewport') as HTMLElement
      return {
        scrollTop: vp?.scrollTop ?? -1,
        scrollHeight: vp?.scrollHeight ?? -1,
        clientHeight: vp?.clientHeight ?? -1,
        hasScrollback: vp?.scrollHeight > vp?.clientHeight,
      }
    })
    console.log('Mobile scroll info:', JSON.stringify(scrollInfo))

    // Also check what mouse mode xterm.js is in
    const termInfo = await page.evaluate(() => {
      const xtermEl = document.querySelector('.xterm')
      return {
        classes: xtermEl?.className ?? '',
        // Check if alternate buffer is active by looking at viewport scroll height
        viewportScrollHeight: (document.querySelector('.xterm-viewport') as HTMLElement)?.scrollHeight ?? 0,
        viewportClientHeight: (document.querySelector('.xterm-viewport') as HTMLElement)?.clientHeight ?? 0,
      }
    })
    console.log('Terminal info:', JSON.stringify(termInfo))

    await ctx.close()
  })
})
