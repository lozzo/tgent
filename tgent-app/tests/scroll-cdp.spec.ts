import { test, expect, devices } from '@playwright/test'

const OC_PANE_ID = '%18'
const TERMINAL_URL = `/terminal/${encodeURIComponent(OC_PANE_ID)}`

function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('mobile: CDP touch swipe in opencode', async ({ browser }) => {
  const iPhone = devices['iPhone 13']
  const ctx = await browser.newContext({ ...iPhone })
  const page = await ctx.newPage()
  await page.goto(TERMINAL_URL)
  await waitMs(3000)

  await page.screenshot({ path: 'tests/screenshots/cdp-before.png' })

  const box = await page.locator('.xterm-screen').boundingBox()
  expect(box).not.toBeNull()

  const cx = box!.x + box!.width / 2
  const startY = box!.y + box!.height * 0.7
  const endY = box!.y + box!.height * 0.3

  // Use CDP to dispatch real touch events
  const cdp = await page.context().newCDPSession(page)

  for (let swipe = 0; swipe < 3; swipe++) {
    // touchStart
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: startY }],
    })
    await waitMs(50)

    // touchMove in steps
    const steps = 10
    for (let s = 1; s <= steps; s++) {
      const y = startY + (endY - startY) * (s / steps)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: cx, y }],
      })
      await waitMs(30)
    }

    // touchEnd
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await waitMs(300)
  }

  await waitMs(1000)
  await page.screenshot({ path: 'tests/screenshots/cdp-after.png' })

  // Also test: check if our touch handler is even being called
  const handlerTest = await page.evaluate(() => {
    return (window as any).__touchScrollCount ?? 'not set'
  })
  console.log('Touch scroll handler calls:', handlerTest)

  await ctx.close()
})

test('desktop: native wheel in opencode', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const page = await ctx.newPage()
  await page.goto(TERMINAL_URL)
  await waitMs(3000)

  await page.screenshot({ path: 'tests/screenshots/wheel-before.png' })

  const box = await page.locator('.xterm-screen').boundingBox()
  expect(box).not.toBeNull()

  // Use CDP to dispatch wheel events (more realistic than page.mouse.wheel)
  const cdp = await page.context().newCDPSession(page)
  for (let i = 0; i < 5; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
      deltaX: 0,
      deltaY: 120,
    })
    await waitMs(200)
  }

  await waitMs(1000)
  await page.screenshot({ path: 'tests/screenshots/wheel-after.png' })

  await ctx.close()
})
