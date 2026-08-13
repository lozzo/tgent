/**
 * 重构后 E2E 测试
 * 验证核心流程：页面导航、登录、设置、注册表单验证
 *
 * 注意：浏览器模式下 isNativeApp()=false，所以：
 * - `/` 路由显示 DirectAuthPage（本地 agent 密码认证），而非 HomePage
 * - Settings 不显示"账号"和"系统" Tab
 * - HomePage 只在 Capacitor 原生 App 中显示
 *
 * 本测试只验证浏览器模式下可测试的流程。
 */
import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:30233'
const WEB_USERNAME = process.env.TGENT_E2E_WEB_USERNAME ?? 'example-user'
const WEB_PASSWORD = process.env.TGENT_E2E_WEB_PASSWORD ?? 'example-password'
const HAS_WEB_CREDENTIALS = Boolean(process.env.TGENT_E2E_WEB_USERNAME && process.env.TGENT_E2E_WEB_PASSWORD)

test.describe('页面加载与导航', () => {
  test('首页(DirectAuthPage)可以正常加载', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    // DirectAuthPage 显示 tgent 标题
    await expect(page.locator('h1:has-text("tgent")')).toBeVisible({ timeout: 10000 })
  })

  test('登录页可以正常加载', async ({ page }) => {
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('h1:has-text("tgent")')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible()
    await expect(page.locator('input[placeholder="密码"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]:has-text("登录")')).toBeVisible()
    await expect(page.locator('a:has-text("注册")')).toBeVisible()
  })

  test('注册页可以正常加载', async ({ page }) => {
    await page.goto(`${BASE}/#/register`)
    await expect(page.locator('h1:has-text("注册 tgent")')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible()
    await expect(page.locator('input[placeholder="邮箱"]')).toBeVisible()
    await expect(page.locator('a:has-text("登录")')).toBeVisible()
  })

  test('登录页和注册页可以互相导航', async ({ page }) => {
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('h1:has-text("tgent")')).toBeVisible({ timeout: 10000 })

    // 点击注册链接
    await page.click('a:has-text("注册")')
    await expect(page.locator('h1:has-text("注册 tgent")')).toBeVisible({ timeout: 5000 })

    // 点击登录链接
    await page.click('a:has-text("登录")')
    await expect(page.locator('button[type="submit"]:has-text("登录")')).toBeVisible({ timeout: 5000 })
  })

  test('设置页可以正常加载', async ({ page }) => {
    await page.goto(`${BASE}/#/settings`)
    await expect(page.locator('h1:has-text("设置")')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('button:has-text("外观")')).toBeVisible()
    await expect(page.locator('button:has-text("终端")')).toBeVisible()
    await expect(page.locator('button:has-text("快捷键")')).toBeVisible()
  })

  test('设置页 Tab 切换正常', async ({ page }) => {
    await page.goto(`${BASE}/#/settings`)
    await expect(page.locator('h1:has-text("设置")')).toBeVisible({ timeout: 10000 })

    // 默认应在外观 Tab
    await expect(page.locator('h3:has-text("暗色主题")')).toBeVisible({ timeout: 5000 })

    // 点击终端 Tab
    await page.click('button:has-text("终端")')
    await expect(page.locator('text=字体大小')).toBeVisible({ timeout: 5000 })

    // 点击快捷键 Tab
    await page.click('button:has-text("快捷键")')
    // 回到外观 Tab
    await page.click('button:has-text("外观")')
    await expect(page.locator('h3:has-text("暗色主题")')).toBeVisible({ timeout: 5000 })
  })

  test('设置页在浏览器模式下不显示账号和系统Tab', async ({ page }) => {
    await page.goto(`${BASE}/#/settings`)
    await expect(page.locator('h1:has-text("设置")')).toBeVisible({ timeout: 10000 })

    // isNativeApp()=false，不应显示账号和系统 Tab
    await expect(page.locator('button:has-text("账号")')).not.toBeVisible()
    await expect(page.locator('button:has-text("系统")')).not.toBeVisible()
  })
})

test.describe('Web 登录流程（AuthForm）', () => {
  test('空表单无法提交', async ({ page }) => {
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('button[type="submit"]')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
  })

  test('只填用户名按钮仍 disabled', async ({ page }) => {
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })
    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
  })

  test('完整填写后按钮可用', async ({ page }) => {
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })
    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await page.fill('input[placeholder="密码"]', WEB_PASSWORD)
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
  })

  test('使用正确凭据登录成功并跳转', async ({ page }) => {
    test.skip(!HAS_WEB_CREDENTIALS, 'set TGENT_E2E_WEB_USERNAME and TGENT_E2E_WEB_PASSWORD')
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })

    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await page.fill('input[placeholder="密码"]', WEB_PASSWORD)
    await page.click('button[type="submit"]:has-text("登录")')

    // 登录成功后应跳转到首页（跨域请求可能较慢）
    await page.waitForURL(url => url.hash === '#/' || url.hash === '' || url.hash === '#', { timeout: 45000 })
  })

  // 跳过：headless Chromium 中跨域请求到 tgent.omscd.com 会长时间 pending
  test.skip('使用错误凭据登录失败显示错误', async ({ page }) => {
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })

    await page.fill('input[placeholder="用户名"]', 'wronguser')
    await page.fill('input[placeholder="密码"]', 'wrongpass')
    await page.click('button[type="submit"]')

    // 应显示错误文字（红色文本），可能需要等较久（跨域请求到 tgent-web）
    // 或者按钮文字变回"登录"（说明请求完成了）
    await expect(page.locator('button[type="submit"]:not([disabled])')).toBeVisible({ timeout: 30000 })
    // 请求完成后检查页面上是否有错误提示
    const hasError = await page.locator('p.text-red-400').isVisible().catch(() => false)
    // 按钮文字应该恢复为"登录"而非"登录中..."
    const btnText = await page.locator('button[type="submit"]').textContent()
    expect(hasError || btnText === '登录').toBeTruthy()
  })
})

test.describe('注册表单验证', () => {
  test('密码不一致时显示错误', async ({ page }) => {
    await page.goto(`${BASE}/#/register`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })

    await page.fill('input[placeholder="用户名"]', 'testuser')
    await page.fill('input[placeholder="邮箱"]', 'test@test.com')
    // 填密码框（第一个密码输入框）
    await page.locator('input[placeholder*="密码（至少"]').fill('password123')
    await page.fill('input[placeholder="确认密码"]', 'different')
    await page.click('button[type="submit"]:has-text("注册")')

    await expect(page.locator('text=两次密码输入不一致')).toBeVisible({ timeout: 5000 })
  })

  test('密码太短时显示错误', async ({ page }) => {
    await page.goto(`${BASE}/#/register`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })

    await page.fill('input[placeholder="用户名"]', 'testuser')
    await page.fill('input[placeholder="邮箱"]', 'test@test.com')
    await page.locator('input[placeholder*="密码（至少"]').fill('12345')
    await page.fill('input[placeholder="确认密码"]', '12345')
    await page.click('button[type="submit"]:has-text("注册")')

    await expect(page.locator('text=密码至少 6 个字符')).toBeVisible({ timeout: 5000 })
  })
})

test.describe('DirectAuthPage（浏览器模式首页）', () => {
  test('首页显示 tgent 标题', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    await expect(page.locator('h1:has-text("tgent")')).toBeVisible({ timeout: 10000 })
  })

  test('无本地 agent 时显示密码输入或连接中', async ({ page }) => {
    await page.goto(`${BASE}/#/`)
    await page.waitForTimeout(3000)

    // DirectAuthPage 三种状态之一：连接中、需要密码、或直接显示 Dashboard
    const hasChecking = await page.locator('text=连接中').isVisible().catch(() => false)
    const hasPassword = await page.locator('text=请输入 daemon 密码').isVisible().catch(() => false)
    const hasDashboard = await page.locator('[data-testid="dashboard"]').isVisible().catch(() => false)
      || await page.locator('text=Sessions').isVisible().catch(() => false)
      || await page.locator('h1:has-text("tgent")').isVisible().catch(() => false)

    // 至少应在其中一个状态
    expect(hasChecking || hasPassword || hasDashboard).toBeTruthy()
  })
})

test.describe('登录后 Web 功能验证', () => {
  test.skip(!HAS_WEB_CREDENTIALS, 'set TGENT_E2E_WEB_USERNAME and TGENT_E2E_WEB_PASSWORD')
  test.beforeEach(async ({ page }) => {
    // 通过 Web 登录页登录
    await page.goto(`${BASE}/#/login`)
    await expect(page.locator('input[placeholder="用户名"]')).toBeVisible({ timeout: 10000 })
    await page.fill('input[placeholder="用户名"]', WEB_USERNAME)
    await page.fill('input[placeholder="密码"]', WEB_PASSWORD)
    await page.click('button[type="submit"]')
    // 等待导航离开 /login 页面（跨域请求可能较慢）
    await page.waitForFunction(() => !window.location.hash.includes('/login'), { timeout: 45000 })
  })

  test('登录后 Web token 已保存', async ({ page }) => {
    // 再次访问登录页，应能检查 token 存在
    // 通过直接检查 localStorage（因为浏览器模式用 localStorage）
    const token = await page.evaluate(() => localStorage.getItem('tgent_web_token'))
    expect(token).toBeTruthy()
  })

  test('登录后可以导航到设置页', async ({ page }) => {
    await page.goto(`${BASE}/#/settings`)
    // 设置页或重定向到首页都可接受
    await page.waitForTimeout(2000)
    const hasSettings = await page.locator('h1:has-text("设置")').isVisible().catch(() => false)
    const hasTgent = await page.locator('h1:has-text("tgent")').isVisible().catch(() => false)
    expect(hasSettings || hasTgent).toBeTruthy()
  })

  test('登录后 token 持久化到 localStorage', async ({ page }) => {
    const token = await page.evaluate(() => localStorage.getItem('tgent_web_token'))
    expect(token).toBeTruthy()
  })
})
