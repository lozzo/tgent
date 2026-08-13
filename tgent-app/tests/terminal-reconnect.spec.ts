import { test, expect, type BrowserContext, type Page } from '@playwright/test'

const AGENT_PASSWORD = process.env.TGENT_E2E_AGENT_PASSWORD ?? ''

test.skip(!AGENT_PASSWORD, 'set TGENT_E2E_AGENT_PASSWORD')
const SESSION_LABEL = process.env.TGENT_E2E_SESSION_LABEL ?? 'LexiFusion-float'
const WINDOW_LABEL = process.env.TGENT_E2E_WINDOW_LABEL ?? 'node'
const PANE_LABEL = process.env.TGENT_E2E_PANE_LABEL ?? 'autossh'
const HOME_URL = '/#/'

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

async function openMobileClient(context: BrowserContext) {
  const page = await context.newPage()
  await ensureLoggedIn(page)
  await openTerminalFromDashboard(page)
  return page
}

function attachConsoleCollector(page: Page) {
  const logs: string[] = []
  const onConsole = (msg: { text(): string }) => logs.push(msg.text())
  page.on('console', onConsole)
  return {
    logs,
    detach: () => page.off('console', onConsole),
  }
}

test.describe('Terminal reconnect', () => {
  test('recovers after offline and online', async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })

    const page = await openMobileClient(context)
    const consoleCapture = attachConsoleCollector(page)

    try {
      await context.setOffline(true)
      await expect
        .poll(async () => (await page.textContent('body')) || '', { timeout: 15000, intervals: [200, 500, 1000] })
        .toContain('等待网络恢复')

      await context.setOffline(false)
      await expect
        .poll(async () => ((await page.textContent('body')) || '').includes('等待网络恢复'), {
          timeout: 20000,
          intervals: [200, 500, 1000],
        })
        .toBeFalsy()
      await expect(page.locator('.xterm-screen')).toBeVisible({ timeout: 20000 })

      await testInfo.attach('terminal-offline-reconnect.json', {
        body: Buffer.from(JSON.stringify({ logs: consoleCapture.logs }, null, 2)),
        contentType: 'application/json',
      })
    } finally {
      consoleCapture.detach()
      await context.close()
    }
  })

  test('survives a Chromium lifecycle freeze and resume approximation', async ({ browser, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'CDP lifecycle freeze requires Chromium')

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })

    const page = await openMobileClient(context)
    const consoleCapture = attachConsoleCollector(page)

    try {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Page.enable')
      await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
      await page.waitForTimeout(9000)
      await cdp.send('Page.setWebLifecycleState', { state: 'active' })

      await expect(page.locator('.xterm-screen')).toBeVisible({ timeout: 20000 })

      await testInfo.attach('terminal-freeze-resume.json', {
        body: Buffer.from(JSON.stringify({ logs: consoleCapture.logs }, null, 2)),
        contentType: 'application/json',
      })
    } finally {
      consoleCapture.detach()
      await context.close()
    }
  })
})
