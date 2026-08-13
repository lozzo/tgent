import { test, expect, devices } from '@playwright/test'

const OC_PANE_ID = '%18'
const TERMINAL_URL = `/terminal/${encodeURIComponent(OC_PANE_ID)}`

function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('mobile touch scroll forwards to opencode', async ({ browser }) => {
  const iPhone = devices['iPhone 13']
  const ctx = await browser.newContext({ ...iPhone })
  const page = await ctx.newPage()
  await page.goto(TERMINAL_URL)
  await waitMs(3000)

  await page.screenshot({ path: 'tests/screenshots/mobile-oc-before.png' })

  const box = await page.locator('.xterm-screen').boundingBox()
  expect(box).not.toBeNull()

  // Simulate single-finger swipe up (scroll down) using Playwright touchscreen
  const cx = box!.x + box!.width / 2
  const startY = box!.y + box!.height * 0.7
  const endY = box!.y + box!.height * 0.3

  // Perform swipe gesture
  for (let i = 0; i < 3; i++) {
    await page.touchscreen.tap(cx, startY)
    await waitMs(50)
    // Swipe by dispatching touch events
    await page.evaluate(({ x, sy, ey }) => {
      const el = document.elementFromPoint(x, sy) || document.querySelector('.xterm-screen')!
      const startTouch = new Touch({ identifier: 1, target: el, clientX: x, clientY: sy })
      el.dispatchEvent(new TouchEvent('touchstart', {
        touches: [startTouch], changedTouches: [startTouch], bubbles: true
      }))
      const steps = 10
      for (let s = 1; s <= steps; s++) {
        const y = sy + (ey - sy) * (s / steps)
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
        el.dispatchEvent(new TouchEvent('touchmove', {
          touches: [t], changedTouches: [t], bubbles: true
        }))
      }
      const endTouch = new Touch({ identifier: 1, target: el, clientX: x, clientY: ey })
      el.dispatchEvent(new TouchEvent('touchend', {
        touches: [], changedTouches: [endTouch], bubbles: true
      }))
    }, { x: cx, sy: startY, ey: endY })
    await waitMs(500)
  }

  await waitMs(1000)
  await page.screenshot({ path: 'tests/screenshots/mobile-oc-after.png' })

  // Check viewport state
  const state = await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement
    return {
      scrollTop: vp?.scrollTop,
      scrollHeight: vp?.scrollHeight,
      clientHeight: vp?.clientHeight,
    }
  })
  console.log('After touch scroll:', JSON.stringify(state))

  await ctx.close()
})
