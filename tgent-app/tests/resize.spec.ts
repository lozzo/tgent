import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { execSync } from 'child_process'

const PANE_ID = process.env.TGENT_E2E_PANE_ID ?? '%18'
const AGENT_PASSWORD = process.env.TGENT_E2E_AGENT_PASSWORD ?? ''

test.skip(!AGENT_PASSWORD, 'set TGENT_E2E_AGENT_PASSWORD')
const SESSION_LABEL = process.env.TGENT_E2E_SESSION_LABEL ?? 'LexiFusion-float'
const WINDOW_LABEL = process.env.TGENT_E2E_WINDOW_LABEL ?? 'node'
const PANE_LABEL = process.env.TGENT_E2E_PANE_LABEL ?? 'autossh'
const HOME_URL = '/#/'

type PaneDimensions = { width: number; height: number }

function getPaneDimensions(): PaneDimensions {
  const out = execSync(
    `tmux display-message -t "${PANE_ID}" -p "#{pane_width}:#{pane_height}"`,
  )
    .toString()
    .trim()

  const [width, height] = out.split(':').map(Number)
  return { width, height }
}

function sameSize(a: PaneDimensions, b: PaneDimensions) {
  return a.width === b.width && a.height === b.height
}

async function ensureLoggedIn(page: Page) {
  await page.goto(HOME_URL)

  const passwordPrompt = page.getByText('请输入 daemon 密码')
  const sessionsButton = page.getByRole('button', { name: 'Sessions' })

  await Promise.race([
    passwordPrompt.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
    sessionsButton.waitFor({ state: 'visible', timeout: 15000 }).catch(() => null),
  ])

  if (await passwordPrompt.isVisible().catch(() => false)) {
    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')
    await expect(passwordPrompt).not.toBeVisible({ timeout: 15000 })
  }

  await expect(sessionsButton).toBeVisible({ timeout: 15000 })
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
  await expect(page.locator('.xterm-screen')).toBeVisible({ timeout: 15000 })
}

async function openClient(context: BrowserContext) {
  const page = await context.newPage()
  await ensureLoggedIn(page)
  await openTerminalFromDashboard(page)
  return page
}

async function waitForPaneResize(assertion: (size: PaneDimensions) => boolean, message: string) {
  await expect
    .poll(() => assertion(getPaneDimensions()), { timeout: 15000, intervals: [200, 300, 500, 800], message })
    .toBeTruthy()
}

test.describe('Terminal resize persistence', () => {
  test('keeps the last app size across disconnect and reconnect', async ({ browser }, testInfo) => {
    test.slow()

    const desktopCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const phoneCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })

    const summary: Record<string, PaneDimensions> = {
      initial: getPaneDimensions(),
    }

    try {
      await openClient(desktopCtx)
      await waitForPaneResize(
        size => !sameSize(size, summary.initial),
        'desktop open should change the pane size',
      )
      summary.afterDesktopOpen = getPaneDimensions()

      await openClient(phoneCtx)
      await waitForPaneResize(
        size => size.width < summary.afterDesktopOpen.width,
        'phone open should become narrower than desktop',
      )
      summary.afterPhoneOpen = getPaneDimensions()

      await phoneCtx.close()
      await expect
        .poll(() => getPaneDimensions(), { timeout: 10000, intervals: [200, 400, 800] })
        .toEqual(summary.afterPhoneOpen)
      summary.afterPhoneDisconnect = getPaneDimensions()

      await desktopCtx.close()
      await expect
        .poll(() => getPaneDimensions(), { timeout: 10000, intervals: [200, 400, 800] })
        .toEqual(summary.afterPhoneOpen)
      summary.afterAllDisconnect = getPaneDimensions()

      const reconnectCtx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      })

      try {
        await openClient(reconnectCtx)
        await expect
          .poll(() => getPaneDimensions(), { timeout: 10000, intervals: [200, 400, 800] })
          .toEqual(summary.afterPhoneOpen)
        summary.afterReconnect = getPaneDimensions()
      } finally {
        await reconnectCtx.close()
      }

      await testInfo.attach('resize-persistence.json', {
        body: Buffer.from(JSON.stringify(summary, null, 2)),
        contentType: 'application/json',
      })

      expect(summary.afterPhoneOpen.width).toBeLessThan(summary.afterDesktopOpen.width)
      expect(summary.afterAllDisconnect).toEqual(summary.afterPhoneOpen)
      expect(summary.afterReconnect).toEqual(summary.afterPhoneOpen)
    } finally {
      await desktopCtx.close().catch(() => {})
      await phoneCtx.close().catch(() => {})
    }
  })
})
