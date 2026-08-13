import { test, expect, type Page } from '@playwright/test'

const PANE_ID = process.env.TGENT_E2E_PANE_ID ?? '%18'
const AGENT_PASSWORD = process.env.TGENT_E2E_AGENT_PASSWORD ?? ''

test.skip(!AGENT_PASSWORD, 'set TGENT_E2E_AGENT_PASSWORD')
const ITERATIONS = Number(process.env.TGENT_E2E_ITERATIONS ?? '5')
const SESSION_LABEL = process.env.TGENT_E2E_SESSION_LABEL ?? 'LexiFusion-float'
const WINDOW_LABEL = process.env.TGENT_E2E_WINDOW_LABEL ?? 'node'
const PANE_LABEL = process.env.TGENT_E2E_PANE_LABEL ?? 'autossh'

const MAX_DC_OPEN_MS = Number(process.env.TGENT_E2E_MAX_DC_OPEN_MS ?? '3000')
const MAX_SNAPSHOT_MS = Number(process.env.TGENT_E2E_MAX_SNAPSHOT_MS ?? '6000')
const MAX_READY_MS = Number(process.env.TGENT_E2E_MAX_READY_MS ?? '8000')
const MAX_READY_SPREAD_MS = Number(process.env.TGENT_E2E_MAX_READY_SPREAD_MS ?? '4000')

const HOME_URL = '/#/'
type RunMetrics = {
  iteration: number
  dcOpenMs: number
  snapshotMs: number
  snapshotWrittenMs: number
  readyMs: number
  snapshotAfterDcMs: number
  readyAfterSnapshotMs: number
  rawLogs: string[]
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function parseMarkerMs(logs: string[], matcher: (msg: string) => boolean): number | null {
  for (const line of logs) {
    const match = line.match(/^\[T \+(\d+)ms\] (.+)$/)
    if (!match) continue
    if (matcher(match[2])) return Number(match[1])
  }
  return null
}

function parseRun(iteration: number, logs: string[]): RunMetrics | null {
  const dcOpenMs = parseMarkerMs(logs, msg => msg === 'DC open')
  const snapshotMs = parseMarkerMs(logs, msg => msg.startsWith('snapshot ') && !msg.startsWith('snapshot written'))
  const snapshotWrittenMs = parseMarkerMs(logs, msg => msg === 'snapshot written')
  const readyMs = parseMarkerMs(logs, msg => msg === 'ready')

  if (dcOpenMs == null || snapshotMs == null || snapshotWrittenMs == null || readyMs == null) {
    return null
  }

  return {
    iteration,
    dcOpenMs,
    snapshotMs,
    snapshotWrittenMs,
    readyMs,
    snapshotAfterDcMs: snapshotMs - dcOpenMs,
    readyAfterSnapshotMs: readyMs - snapshotMs,
    rawLogs: logs,
  }
}

async function ensureLoggedIn(page: Page) {
  await page.goto(HOME_URL)

  const passwordPrompt = page.locator('text=请输入 daemon 密码')
  const dashboard = page.locator('[data-testid="dashboard"]')

  if (await passwordPrompt.isVisible().catch(() => false)) {
    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')
    await expect(passwordPrompt).not.toBeVisible({ timeout: 15000 })
    return
  }

  await Promise.race([
    passwordPrompt.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    dashboard.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null),
    page.waitForTimeout(5000),
  ])

  if (await passwordPrompt.isVisible().catch(() => false)) {
    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')
    await expect(passwordPrompt).not.toBeVisible({ timeout: 15000 })
  }
}

async function openTerminalFromDashboard(page: Page) {
  await page.goto(HOME_URL)
  await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible({ timeout: 15000 })

  const sessionRow = page.locator(`text=${SESSION_LABEL}`).first()
  const windowRows = page.locator(`text=${WINDOW_LABEL}`)
  const paneRow = page.locator(`text=${PANE_LABEL}`).first()

  if (!(await windowRows.first().isVisible().catch(() => false)) && !(await paneRow.isVisible().catch(() => false))) {
    await sessionRow.click()
    await expect(windowRows.first()).toBeVisible({ timeout: 15000 })
  }

  if (!(await paneRow.isVisible().catch(() => false))) {
    const windowCount = await windowRows.count()
    for (let i = 0; i < windowCount; i++) {
      await windowRows.nth(i).click()
      if (await paneRow.isVisible().catch(() => false)) break
      await paneRow.waitFor({ state: 'visible', timeout: 1000 }).catch(() => null)
      if (await paneRow.isVisible().catch(() => false)) break
    }
    await expect(paneRow).toBeVisible({ timeout: 15000 })
  }

  await paneRow.click()
}

async function measureTerminalOpen(page: Page, iteration: number): Promise<RunMetrics> {
  const logs: string[] = []
  const onConsole = (msg: { text(): string }) => {
    logs.push(msg.text())
  }

  page.on('console', onConsole)
  try {
    await openTerminalFromDashboard(page)
    await expect(page.locator('.xterm-screen')).toBeVisible({ timeout: 15000 })

    await expect
      .poll(() => parseRun(iteration, logs), { timeout: 15000, intervals: [100, 200, 300, 500] })
      .not.toBeNull()

    const metrics = parseRun(iteration, logs)
    if (!metrics) throw new Error(`run ${iteration}: failed to parse terminal logs`)
    return metrics
  } finally {
    page.off('console', onConsole)
  }
}

test.describe('Terminal open latency', () => {
  test('opens terminal channel and snapshot within budget across repeated runs', async ({ browser }, testInfo) => {
    test.slow()

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()

    try {
      await ensureLoggedIn(page)

      const runs: RunMetrics[] = []
      for (let i = 1; i <= ITERATIONS; i++) {
        const metrics = await measureTerminalOpen(page, i)
        runs.push(metrics)
        await page.goto(HOME_URL)
        await sleep(300)
      }

      const readyTimes = runs.map(run => run.readyMs)
      const summary = {
        paneId: PANE_ID,
        iterations: ITERATIONS,
        budgets: {
          dcOpenMs: MAX_DC_OPEN_MS,
          snapshotMs: MAX_SNAPSHOT_MS,
          readyMs: MAX_READY_MS,
          readySpreadMs: MAX_READY_SPREAD_MS,
        },
        runs,
        aggregate: {
          minReadyMs: Math.min(...readyTimes),
          maxReadyMs: Math.max(...readyTimes),
          readySpreadMs: Math.max(...readyTimes) - Math.min(...readyTimes),
          avgReadyMs: Math.round(readyTimes.reduce((sum, n) => sum + n, 0) / readyTimes.length),
        },
      }

      await testInfo.attach('terminal-open-latency.json', {
        body: Buffer.from(JSON.stringify(summary, null, 2)),
        contentType: 'application/json',
      })

      for (const run of runs) {
        expect(run.dcOpenMs, `run ${run.iteration} dcOpenMs`).toBeLessThanOrEqual(MAX_DC_OPEN_MS)
        expect(run.snapshotMs, `run ${run.iteration} snapshotMs`).toBeLessThanOrEqual(MAX_SNAPSHOT_MS)
        expect(run.readyMs, `run ${run.iteration} readyMs`).toBeLessThanOrEqual(MAX_READY_MS)
        expect(run.snapshotAfterDcMs, `run ${run.iteration} snapshotAfterDcMs`).toBeGreaterThanOrEqual(0)
        expect(run.readyAfterSnapshotMs, `run ${run.iteration} readyAfterSnapshotMs`).toBeGreaterThanOrEqual(0)
      }

      expect(
        summary.aggregate.readySpreadMs,
        `ready spread too large: ${summary.aggregate.readySpreadMs}ms`,
      ).toBeLessThanOrEqual(MAX_READY_SPREAD_MS)
    } finally {
      await context.close()
    }
  })
})
