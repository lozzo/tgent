import { test, devices } from '@playwright/test'

const PANE_ID = '%19'
const URL = `/terminal/${encodeURIComponent(PANE_ID)}`

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function run(page: any, label: string) {
  const logs: string[] = []
  page.on('console', (m: any) => logs.push(m.text()))

  await page.goto(URL)
  await sleep(6000)

  // 只打印 [T 开头的日志（xterm 内部状态）
  const tLogs = logs.filter(l => l.startsWith('[T '))
  console.log(`\n===== ${label}: xterm 内部时间线 (${tLogs.length} entries) =====`)
  for (const l of tLogs) console.log(l)

  // 单独列出所有 SCROLL 事件
  const scrolls = tLogs.filter(l => l.includes('SCROLL'))
  console.log(`\n--- ${label}: SCROLL 事件 (${scrolls.length}) ---`)
  for (const s of scrolls) console.log(s)

  // 最终 viewport 状态
  const final = await page.evaluate(() => {
    const vp = document.querySelector('.xterm-viewport') as HTMLElement
    return vp ? `scrollTop=${vp.scrollTop} scrollHeight=${vp.scrollHeight} clientHeight=${vp.clientHeight}` : 'no viewport'
  })
  console.log(`\n--- ${label}: 最终状态: ${final} ---`)
}

test('desktop', async ({ page }) => { await run(page, 'desktop') })

test('mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] })
  await run(await ctx.newPage(), 'mobile')
  await ctx.close()
})
