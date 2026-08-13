import { test, devices } from '@playwright/test'

const PANE_ID = '%18'
const TERMINAL_URL = `/terminal/${encodeURIComponent(PANE_ID)}`

function waitMs(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('mobile: verify opacity fade-in', async ({ browser }) => {
  const iPhone = devices['iPhone 13']
  const ctx = await browser.newContext({ ...iPhone })
  const page = await ctx.newPage()

  const logs: { time: number; text: string }[] = []
  const t0 = Date.now()
  page.on('console', msg => {
    logs.push({ time: Date.now() - t0, text: msg.text() })
  })

  // Take screenshots every 100ms
  const screenshots: Promise<void>[] = []
  let idx = 0
  const interval = setInterval(() => {
    const i = idx++
    screenshots.push(
      page.screenshot({ path: `tests/screenshots/fade-${String(i).padStart(2, '0')}.png` })
        .catch(() => {})
    )
  }, 100)

  await page.goto(TERMINAL_URL)
  await waitMs(3000)

  clearInterval(interval)
  await Promise.all(screenshots)

  console.log(`Took ${idx} screenshots`)

  // Print key events
  const keyLogs = logs.filter(l =>
    l.text.includes('[Terminal') || l.text.includes('[TerminalPage]')
  )
  console.log('\n=== Key Events ===')
  for (const e of keyLogs) {
    console.log(`  [${e.time}ms] ${e.text}`)
  }

  // Check opacity at various points
  const opacityCheck = await page.evaluate(() => {
    const container = document.querySelector('[class*="fixed"]') as HTMLElement
    return {
      opacity: container?.style.opacity,
      transition: container?.style.transition,
      computedOpacity: container ? getComputedStyle(container).opacity : null,
    }
  })
  console.log('\n=== Opacity State ===', JSON.stringify(opacityCheck))

  await ctx.close()
})
