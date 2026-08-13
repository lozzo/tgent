import { execFileSync } from 'node:child_process'
import { test, expect, type Page } from '@playwright/test'

const enabled = process.env.TGENT_ZELLIJ_E2E === '1'
const localPassword = process.env.TGENT_TEST_PASSWORD || ''
const webUser = process.env.TGENT_WEB_USER || ''
const webPassword = process.env.TGENT_WEB_PASSWORD || ''
const serverName = process.env.TGENT_E2E_SERVER_NAME || 'RedmiBook.local'
const zellijSession = process.env.TGENT_ZELLIJ_SESSION || 'profound-magpie'

async function zellijPaneSize() {
  const output = execFileSync('zellij', [
    '--session',
    zellijSession,
    'action',
    'list-panes',
    '--json',
    '--all',
  ], { encoding: 'utf8' })
  const pane = (JSON.parse(output) as Array<{
    is_plugin: boolean
    pane_content_columns: number
    pane_content_rows: number
  }>).find(item => !item.is_plugin)
  if (!pane) throw new Error('No Zellij terminal pane found')
  return [pane.pane_content_columns, pane.pane_content_rows] as const
}

async function authenticate(page: Page) {
  if (!webUser) {
    await page.addInitScript(({ password }) => {
      localStorage.setItem('tgent_local_servers', JSON.stringify([{
        id: '__direct__',
        name: 'Local daemon',
        addr: window.location.origin,
        password,
        addedAt: Date.now(),
      }]))
    }, { password: localPassword })
    await page.goto('/#/')
    const passwordInput = page.locator('input[placeholder="密码"]')
    if (await passwordInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await passwordInput.fill(localPassword)
      await page.locator('button[type="submit"]').click()
    }
    await expect(page.getByText('Zellij', { exact: true })).toBeVisible({ timeout: 30000 })
    return
  }
  await page.goto('/#/login')
  await page.locator('input[placeholder="用户名"]').fill(webUser)
  await page.locator('input[placeholder="密码"]').fill(webPassword)
  await page.locator('button[type="submit"]').click()
  await expect(page.getByText(serverName, { exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByText(serverName, { exact: true }).click()
  await expect(page.getByText('Zellij', { exact: true })).toBeVisible({ timeout: 15000 })
}

test.describe('Zellij terminal parity', () => {
  test.skip(!enabled, 'Set TGENT_ZELLIJ_E2E=1 to run against a local Zellij session')

  test('resizes the pane and opens the shared terminal switcher', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 820 })
    await authenticate(page)

    const topology = page.getByLabel('其他终端来源')
    const session = topology
      .getByRole('button', { name: new RegExp(`^${zellijSession} `) })
      .locator('..')
    await session.getByRole('button', { name: /^Pane #1 / }).click()
    const terminalHeader = page.locator('header').filter({
      has: page.getByRole('button', { name: '文件管理' }),
    })
    await expect(terminalHeader).toContainText('Pane #1', { timeout: 15000 })

    await expect.poll(zellijPaneSize, { timeout: 10000 }).toBeTruthy()
    const before = await zellijPaneSize()
    await page.setViewportSize({ width: 1180, height: 700 })
    await expect.poll(zellijPaneSize, { timeout: 10000 }).not.toEqual(before)

    await terminalHeader.locator('.cursor-pointer').click()
    await expect(page.getByText('选择终端', { exact: true })).toBeVisible()
    await expect(page.getByText('当前', { exact: true })).toBeVisible()
    await expect(page.getByText(zellijSession, { exact: true })).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'test-results/zellij-terminal-switcher.png' })

    await page.mouse.click(20, 100)
    await expect(page.getByText('选择终端', { exact: true })).not.toBeVisible()
    const terminalInput = page.getByRole('textbox', { name: 'Terminal input' })
    await terminalInput.focus()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    await page.screenshot({ path: 'test-results/zellij-terminal-after-enter.png' })
  })

  test('routes full-screen application gestures inside the terminal', async ({ page }) => {
    test.skip(process.env.TGENT_ZELLIJ_HTOP_E2E !== '1', 'Set TGENT_ZELLIJ_HTOP_E2E=1 with htop running')
    await page.setViewportSize({ width: 900, height: 820 })
    await authenticate(page)

    const topology = page.getByLabel('其他终端来源')
    const session = topology
      .getByRole('button', { name: new RegExp(`^${zellijSession} `) })
      .locator('..')
    await session.getByRole('button', { name: /^Pane #1 / }).click()

    const terminal = page.locator('[data-terminal-application-mode="true"]')
    await expect(terminal).toBeVisible({ timeout: 15000 })
    const scrollPosition = await terminal.evaluate(container => {
      const screen = container.querySelector('.xterm-screen') as HTMLElement
      const viewport = container.querySelector('.xterm-viewport') as HTMLElement
      const rect = screen.getBoundingClientRect()
      const dispatchTouch = (type: string, y: number) => {
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'touches', {
          value: type === 'touchend' ? [] : [{ clientX: rect.left + rect.width / 2, clientY: y }],
        })
        screen.dispatchEvent(event)
      }
      const before = viewport.scrollTop
      dispatchTouch('touchstart', rect.top + rect.height * 0.75)
      dispatchTouch('touchmove', rect.top + rect.height * 0.25)
      dispatchTouch('touchend', rect.top + rect.height * 0.25)
      return { before, after: viewport.scrollTop }
    })
    expect(scrollPosition.after).toBe(scrollPosition.before)
    await page.screenshot({ path: 'test-results/zellij-htop-application-mode.png' })
  })
})
