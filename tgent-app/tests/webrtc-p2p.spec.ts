import { test, expect } from '@playwright/test'

const HUB_URL = process.env.TGENT_E2E_HUB_URL ?? ''
const HUB_USER = process.env.TGENT_E2E_HUB_USERNAME ?? ''
const HUB_PASS = process.env.TGENT_E2E_HUB_PASSWORD ?? ''
const AGENT_ID = process.env.TGENT_E2E_AGENT_ID ?? ''

test.skip(
  !HUB_URL || !HUB_USER || !HUB_PASS || !AGENT_ID,
  'set TGENT_E2E_HUB_URL, TGENT_E2E_HUB_USERNAME, TGENT_E2E_HUB_PASSWORD, and TGENT_E2E_AGENT_ID',
)

/** 通过 Hub API 登录获取 token */
async function hubLogin(): Promise<string> {
  const resp = await fetch(`${HUB_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: HUB_USER, password: HUB_PASS }),
  })
  if (!resp.ok) throw new Error(`Hub login failed: ${resp.status}`)
  const data = await resp.json()
  return data.token
}

test.describe('WebRTC P2P', () => {
  let token: string

  test.beforeEach(async ({ page }) => {
    token = await hubLogin()
    // 先导航到应用页面（同源），才能访问 localStorage
    await page.goto('/')
    await page.evaluate(
      ({ hubUrl, tok }) => {
        localStorage.setItem('tgent_hub_url', hubUrl)
        localStorage.setItem('tgent_hub_token', tok)
      },
      { hubUrl: HUB_URL, tok: token },
    )
  })

  test('P2P test page: ICE config + connect + sessions', async ({ page }) => {
    test.setTimeout(60000)

    await page.goto(`/test/webrtc?agentId=${AGENT_ID}`)

    // 等待所有步骤完成（overall 不再是 running）
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="overall"]')
        return el && el.getAttribute('data-status') !== 'running'
      },
      { timeout: 45000 },
    )

    // 截图
    await page.screenshot({ path: 'tests/screenshots/webrtc-test-page.png' })

    // 验证每个步骤
    const step0 = page.locator('[data-testid="step-0"]')
    await expect(step0).toHaveAttribute('data-status', 'pass')

    const step1 = page.locator('[data-testid="step-1"]')
    await expect(step1).toHaveAttribute('data-status', 'pass')

    const step2 = page.locator('[data-testid="step-2"]')
    await expect(step2).toHaveAttribute('data-status', 'pass')

    // 总体通过
    const overall = page.locator('[data-testid="overall"]')
    await expect(overall).toHaveAttribute('data-status', 'pass')
  })

  test('Hub session page shows sessions via P2P (Bug 2 regression)', async ({ page }) => {
    test.setTimeout(60000)

    await page.goto(`/hub/${AGENT_ID}`)

    // 等待 session 列表加载完成（"N sessions" 文本出现）
    await page.waitForFunction(
      () => document.body.textContent?.match(/\d+ sessions/),
      { timeout: 30000 },
    )

    // 截图
    await page.screenshot({ path: 'tests/screenshots/webrtc-hub-sessions.png' })

    // 验证显示了 session 数量
    const bodyText = await page.textContent('body')
    expect(bodyText).toMatch(/\d+ sessions/)
    expect(bodyText).not.toContain('连接超时')
    expect(bodyText).not.toContain('P2P 连接失败')
  })
})
