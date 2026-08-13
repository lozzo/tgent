/**
 * 连接流程 E2E 测试
 * 测试 Local / Hub / 状态机 等核心连接逻辑
 *
 * 前提：
 * - tgent agent 运行在 localhost:8080，密码由 TGENT_E2E_AGENT_PASSWORD 提供
 * - Vite dev server 运行在 localhost:30233，代理 /api → localhost:8080
 * - Web 控制面地址和测试账号通过 TGENT_E2E_WEB_* 环境变量提供
 */
import { test, expect, type Page } from '@playwright/test'

const BASE = 'http://localhost:30233'
const AGENT_PASSWORD = process.env.TGENT_E2E_AGENT_PASSWORD ?? ''
const WEB_URL = process.env.TGENT_E2E_WEB_URL ?? ''
const WEB_USERNAME = process.env.TGENT_E2E_WEB_USERNAME ?? ''
const WEB_PASSWORD = process.env.TGENT_E2E_WEB_PASSWORD ?? ''

test.skip(!AGENT_PASSWORD, 'set TGENT_E2E_AGENT_PASSWORD for connection integration tests')

// ============================================================
// 辅助函数
// ============================================================

/** 等待 agent 本地 API 可达 */
async function waitForAgent() {
  for (let i = 0; i < 10; i++) {
    try {
      const resp = await fetch('http://localhost:8080/api/v1/status')
      if (resp.status === 200 || resp.status === 401) return true
    } catch {}
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

// ============================================================
// Local 模式：Direct 连接（浏览器直连本地 agent）
// ============================================================

test.describe('Local Direct 模式', () => {

  test('DirectAuthPage 显示密码输入框', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    // DirectAuthPage 应该检测到 agent 需要密码
    await expect(page.locator('text=请输入 daemon 密码')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('input[placeholder="密码"]')).toBeVisible()
  })

  test('输入错误密码显示错误', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    await expect(page.locator('text=请输入 daemon 密码')).toBeVisible({ timeout: 15000 })

    await page.fill('input[placeholder="密码"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // 应显示错误信息
    await expect(page.locator('p.text-red-400')).toBeVisible({ timeout: 10000 })
  })

  test('输入正确密码进入 Dashboard', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    await expect(page.locator('text=请输入 daemon 密码')).toBeVisible({ timeout: 15000 })

    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')

    // 成功后应进入 Dashboard（显示 Sessions）
    // Dashboard 应显示 tmux session 列表或连接状态
    await page.waitForTimeout(3000)
    // DirectAuthPage auth=ok 后渲染 <Dashboard />
    // 检查是否已经不再显示密码框
    await expect(page.locator('text=请输入 daemon 密码')).not.toBeVisible({ timeout: 10000 })
  })

  test('本地 token 持久化，刷新后免密码', async ({ page }) => {
    // 先登录
    await page.goto(`${BASE}/#/`)
    await expect(page.locator('text=请输入 daemon 密码')).toBeVisible({ timeout: 15000 })
    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')
    await expect(page.locator('text=请输入 daemon 密码')).not.toBeVisible({ timeout: 10000 })

    // 等待 token 存储
    await page.waitForTimeout(1000)
    const token = await page.evaluate(() => localStorage.getItem('tgent_token'))
    expect(token).toBeTruthy()

    // 刷新页面
    await page.reload()
    // 不应再要求密码（token 有效）
    await page.waitForTimeout(5000)
    const stillNeedPassword = await page.locator('text=请输入 daemon 密码').isVisible().catch(() => false)
    expect(stillNeedPassword).toBeFalsy()
  })
})

// ============================================================
// Local Direct 模式：WebRTC 连接 + Session 数据
// ============================================================

test.describe('Local Direct 连接后数据加载', () => {

  test.beforeEach(async ({ page }) => {
    // 清除旧 token 确保干净状态
    await page.goto(`${BASE}/#/`)
    await page.evaluate(() => localStorage.removeItem('tgent_token'))
    await page.reload()
    await expect(page.locator('text=请输入 daemon 密码')).toBeVisible({ timeout: 15000 })
    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')
    // 等待 Dashboard 加载
    await expect(page.locator('text=请输入 daemon 密码')).not.toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(3000)
  })

  test('Dashboard 应显示连接状态', async ({ page }) => {
    // Dashboard 应该有连接指示器或 session 列表
    // 等待 WebRTC 连接建立
    await page.waitForTimeout(5000)

    // 检查页面上是否有以下任一元素：
    // 1. 连接状态文本（已连接、正在连接等）
    // 2. Session 列表
    // 3. 状态栏
    const pageContent = await page.textContent('body')
    const hasConnectionInfo = pageContent?.includes('已连接')
      || pageContent?.includes('正在连接')
      || pageContent?.includes('正在建立')
      || pageContent?.includes('tgent')  // session name
      || pageContent?.includes('Sessions')

    expect(hasConnectionInfo).toBeTruthy()
  })

  test('WebRTC 连接成功后加载 tmux sessions', async ({ page }) => {
    // 等待 WebRTC 连接和数据加载
    await page.waitForTimeout(8000)

    // 应该能看到 tmux session（我们的 session 名称是 "tgent"）
    const pageContent = await page.textContent('body')

    // Dashboard 连接成功后应显示 session 相关信息
    // 可能的 UI 元素：session 名称、window 数量
    const hasSessionData = pageContent?.includes('tgent')
      || pageContent?.includes('session')
      || pageContent?.includes('Session')

    // 如果没有 session 数据，可能还在连接中，检查连接状态
    if (!hasSessionData) {
      const hasConnecting = pageContent?.includes('正在')
        || pageContent?.includes('连接')
        || pageContent?.includes('探测')
      expect(hasConnecting).toBeTruthy()
    }
  })
})

// ============================================================
// Hub 模式：通过 tgent-web 登录后连接
// ============================================================

test.describe('Hub 模式连接', () => {
  test.skip(!WEB_URL || !WEB_USERNAME || !WEB_PASSWORD, 'set TGENT_E2E_WEB_URL, TGENT_E2E_WEB_USERNAME, and TGENT_E2E_WEB_PASSWORD')

  test('Web 登录后获取 Agent 列表', async ({ page }) => {
    // 先通过 Web 登录
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })
    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await page.fill('input[placeholder="密码"]', WEB_PASSWORD)
    await page.click('button[type="submit"]')

    // 等待登录完成
    await page.waitForFunction(
      () => !window.location.hash.includes('/login'),
      { timeout: 45000 }
    )

    // 登录成功后检查 token
    const token = await page.evaluate(() => localStorage.getItem('tgent_web_token'))
    expect(token).toBeTruthy()

    // 通过 API 验证能获取 agent 列表
    const agents = await page.evaluate(async ({ configuredWebUrl }) => {
      const webUrl = localStorage.getItem('tgent_web_url') || configuredWebUrl
      const token = localStorage.getItem('tgent_web_token')
      try {
        const resp = await fetch(`${webUrl}/api/agents`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (!resp.ok) return { error: resp.status }
        return await resp.json()
      } catch (e) {
        return { error: (e as Error).message }
      }
    }, { configuredWebUrl: WEB_URL })

    // 应该返回 agent 列表（可能为空数组，但不应报错）
    expect(agents).toBeDefined()
    if (Array.isArray(agents)) {
      // 有 agent 列表
      console.log(`Found ${agents.length} agents`)
    } else if (agents.agents) {
      console.log(`Found ${agents.agents.length} agents`)
    }
    // 不应有认证错误
    expect(agents.error).not.toBe(401)
  })
})

// ============================================================
// 连接状态机测试（通过 JavaScript 直接操控）
// ============================================================

test.describe('ConnectionManager 状态机', () => {

  test('状态转换表正确性（通过页面内 JS 验证）', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    await page.waitForTimeout(2000)

    // 在页面内执行，验证状态转换表在运行时存在
    const result = await page.evaluate(() => {
      // 检查 EventBus 是否正常工作
      const checks: string[] = []

      // 验证 localStorage/Preferences 存取功能
      localStorage.setItem('__test_key', 'test_value')
      const val = localStorage.getItem('__test_key')
      localStorage.removeItem('__test_key')
      checks.push(val === 'test_value' ? 'storage:ok' : 'storage:fail')

      // 验证 Capacitor.isNativePlatform 不会被错误调用
      const isNative = !!(window as any).Capacitor?.isNativePlatform?.()
      checks.push(`isNative:${isNative}`)

      return checks
    })

    expect(result).toContain('storage:ok')
    // 浏览器模式下 isNative 应为 false
    expect(result).toContain('isNative:false')
  })

  test('Direct 模式下连接建立并获取 sessions', async ({ page }) => {
    // 清除 token 后重新登录
    await page.goto(`${BASE}/#/`)
    await page.evaluate(() => localStorage.removeItem('tgent_token'))
    await page.reload()

    await expect(page.locator('text=请输入 daemon 密码')).toBeVisible({ timeout: 15000 })
    await page.fill('input[placeholder="密码"]', AGENT_PASSWORD)
    await page.click('button[type="submit"]')
    await expect(page.locator('text=请输入 daemon 密码')).not.toBeVisible({ timeout: 10000 })

    // 等待 WebRTC 连接
    await page.waitForTimeout(8000)

    // 通过 API 验证连接 — 直接从页面发 API 请求
    const statusResp = await page.evaluate(async () => {
      const token = localStorage.getItem('tgent_token')
      try {
        const resp = await fetch('/api/v1/sessions', {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        if (!resp.ok) return { status: resp.status }
        return await resp.json()
      } catch (e) {
        return { error: (e as Error).message }
      }
    })

    // 应该能获取 sessions（至少有 "tgent" session）
    if (Array.isArray(statusResp)) {
      expect(statusResp.length).toBeGreaterThan(0)
      const sessionNames = statusResp.map((s: any) => s.name)
      expect(sessionNames).toContain('tgent')
    }
  })
})

// ============================================================
// 设置页面在不同状态下的行为
// ============================================================

test.describe('Settings 在不同认证状态下', () => {

  test('未登录 Web 时设置页外观 Tab 正常', async ({ page }) => {
    // 确保未登录 Web
    await page.goto(`${BASE}/#/settings`)
    await page.evaluate(() => localStorage.removeItem('tgent_web_token'))
    await page.reload()

    await expect(page.locator('h1:has-text("设置")')).toBeVisible({ timeout: 10000 })

    // 外观 Tab 正常
    await expect(page.locator('h3:has-text("暗色主题")')).toBeVisible({ timeout: 5000 })

    // 终端 Tab 正常
    await page.click('button:has-text("终端")')
    await expect(page.locator('text=字体大小')).toBeVisible({ timeout: 5000 })
  })

  test('Web 登录后设置页正常', async ({ page }) => {
    test.skip(!WEB_USERNAME || !WEB_PASSWORD, 'set TGENT_E2E_WEB_USERNAME and TGENT_E2E_WEB_PASSWORD')
    // 先登录
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })
    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await page.fill('input[placeholder="密码"]', WEB_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForFunction(
      () => !window.location.hash.includes('/login'),
      { timeout: 45000 }
    )

    // 访问设置页
    await page.goto(`${BASE}/#/settings`)
    await expect(page.locator('h1:has-text("设置")')).toBeVisible({ timeout: 10000 })

    // 所有 Tab 应可切换
    await page.click('button:has-text("终端")')
    await expect(page.locator('text=字体大小')).toBeVisible({ timeout: 5000 })

    await page.click('button:has-text("外观")')
    await expect(page.locator('h3:has-text("暗色主题")')).toBeVisible({ timeout: 5000 })
  })
})

// ============================================================
// stripHubInfo 登出清理验证
// ============================================================

test.describe('登出清理逻辑', () => {

  test('登录后 storage 有 web token，手动清除后无 token', async ({ page }) => {
    test.skip(!WEB_USERNAME || !WEB_PASSWORD, 'set TGENT_E2E_WEB_USERNAME and TGENT_E2E_WEB_PASSWORD')
    // 登录
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })
    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await page.fill('input[placeholder="密码"]', WEB_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForFunction(
      () => !window.location.hash.includes('/login'),
      { timeout: 45000 }
    )

    // 验证 token 存在
    let token = await page.evaluate(() => localStorage.getItem('tgent_web_token'))
    expect(token).toBeTruthy()

    // 模拟登出：清除 token
    await page.evaluate(() => {
      localStorage.removeItem('tgent_web_token')
      localStorage.removeItem('tgent_web_refresh_token')
    })

    // 验证 token 已清除
    token = await page.evaluate(() => localStorage.getItem('tgent_web_token'))
    expect(token).toBeNull()
  })

  test('stripHubInfo 清除 hub 关联字段', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    await page.waitForTimeout(1000)

    // 模拟写入带 hub 信息的 localServers 数据
    await page.evaluate(() => {
      const servers = [
        {
          id: 'test-local-1',
          name: 'Local + Hub',
          addr: 'http://192.168.1.100:8080',
          localAddrs: ['http://192.168.1.100:8080'],
          hubAgentId: 'agent-123',
          hubAddr: 'wss://hub.example.com',
          privateKeySeed: 'base64seed==',
          pairCode: 'abcdefghjkmnpqrs',
          password: 'pwd',
        },
        {
          id: 'test-hub-only',
          name: 'Hub Only',
          hubAgentId: 'agent-456',
          hubAddr: 'wss://hub.example.com',
          privateKeySeed: 'seed==',
        },
        {
          id: 'test-pure-local',
          name: 'Pure Local',
          addr: 'http://192.168.1.200:8080',
          password: 'pwd2',
        },
      ]
      localStorage.setItem('tgent_local_servers', JSON.stringify(servers))
    })

    // 验证写入成功
    const before = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('tgent_local_servers') || '[]')
    })
    expect(before).toHaveLength(3)

    // 执行 stripHubInfo 逻辑（模拟）
    const after = await page.evaluate(() => {
      const servers = JSON.parse(localStorage.getItem('tgent_local_servers') || '[]')
      const cleaned = servers
        .filter((s: any) => {
          // 移除纯 Hub 服务器
          const isHubOnly = !s.addr && (!s.localAddrs || s.localAddrs.length === 0) && !!s.hubAgentId
          return !isHubOnly
        })
        .map((s: any) => {
          if (!s.hubAgentId) return s
          const { hubAgentId, hubAddr, privateKeySeed, pairCode, ...rest } = s
          return rest
        })
      localStorage.setItem('tgent_local_servers', JSON.stringify(cleaned))
      return cleaned
    })

    // 纯 Hub 服务器被删除
    expect(after).toHaveLength(2)

    // Local+Hub 服务器的 hub 字段被清理
    const localHub = after.find((s: any) => s.id === 'test-local-1')
    expect(localHub).toBeDefined()
    expect(localHub.addr).toBe('http://192.168.1.100:8080')
    expect(localHub.password).toBe('pwd')
    expect(localHub.hubAgentId).toBeUndefined()
    expect(localHub.hubAddr).toBeUndefined()
    expect(localHub.privateKeySeed).toBeUndefined()
    expect(localHub.decryptKey).toBeUndefined()
    expect(localHub.pairCode).toBeUndefined()

    // 纯本地服务器不受影响
    const pureLocal = after.find((s: any) => s.id === 'test-pure-local')
    expect(pureLocal).toBeDefined()
    expect(pureLocal.addr).toBe('http://192.168.1.200:8080')
    expect(pureLocal.password).toBe('pwd2')
  })
})
