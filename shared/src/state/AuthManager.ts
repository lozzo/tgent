/**
 * Token 管理器
 * 封装 Web token 的 get/set/clear，实现 token 刷新和会话过期处理
 *
 * App 端使用 Bearer token，refresh token 存在客户端 localStorage，
 * 服务端无法像 Web cookie 那样透明刷新，因此保留 401 → refresh → 重试逻辑。
 * 服务端 refresh 端点会自动滚动续期 refresh token（过半寿命时），
 * 客户端只需检查响应中是否有新的 refresh_token 并保存。
 */

import { eventBus } from './EventBus'
import {
  getWebToken,
  setWebToken,
  getWebRefreshToken,
  setWebRefreshToken,
  clearWebToken,
  getWebUrl,
} from '../lib/platform'
import { stripHubInfo } from '../lib/localServers'
import { clearCachedSubscription } from '../lib/subscriptionCache'

export class AuthManager {
  private static _instance: AuthManager | null = null

  static getInstance(): AuthManager {
    if (!AuthManager._instance) {
      AuthManager._instance = new AuthManager()
    }
    return AuthManager._instance
  }

  /** 获取当前 Web token */
  getToken(): Promise<string | null> {
    return getWebToken()
  }

  /** 获取当前 refresh token */
  getRefreshToken(): Promise<string | null> {
    return getWebRefreshToken()
  }

  /** 是否已登录 */
  async checkLoggedIn(): Promise<boolean> {
    return !!(await getWebToken())
  }

  /** 保存 token（登录成功后调用） */
  async setTokens(token: string, refreshToken: string): Promise<void> {
    await setWebToken(token)
    await setWebRefreshToken(refreshToken)
    eventBus.emit('auth:login', {})
  }

  /**
   * 尝试刷新 token（单例防并发）
   * @returns 1 = 刷新成功, 0 = auth 确认过期, -1 = 网络/服务器错误
   */
  async tryRefreshToken(): Promise<number> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.doRefresh()
    const result = await this.refreshPromise
    this.refreshPromise = null
    return result
  }

  private refreshPromise: Promise<number> | null = null

  private async doRefresh(): Promise<number> {
    const refreshToken = await getWebRefreshToken()
    if (!refreshToken) return 0
    try {
      const webUrl = await getWebUrl()
      const resp = await fetch(`${webUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Type': 'app',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (resp.ok) {
        const data = await resp.json()
        await setWebToken(data.token)
        if (data.refresh_token) {
          await setWebRefreshToken(data.refresh_token)
        }
        eventBus.emit('auth:tokenRefreshed', {})
        return 1
      }
      // 401/403 = refresh token 确认过期
      if (resp.status === 401 || resp.status === 403) return 0
      // 其他状态码（500 等）= 服务端错误
      return -1
    } catch {
      return -1
    }
  }

  /** 处理会话过期：清 token + 发布事件 + toast 提示 */
  async handleSessionExpired(returnTo?: string): Promise<void> {
    await Promise.all([clearWebToken(), clearCachedSubscription()])
    eventBus.emit('auth:sessionExpired', { returnTo })
    eventBus.emit('toast:show', {
      message: '登录已过期，请重新登录',
      type: 'error',
    })
  }

  /** 登出：调后端撤销 refresh token + 清本地 token + 清 Hub 关联信息 + 发布事件 */
  async logout(): Promise<void> {
    // 先调后端删除 refresh token（fire-and-forget，不阻塞）
    const refreshToken = await getWebRefreshToken()
    if (refreshToken) {
      const webUrl = await getWebUrl()
      fetch(`${webUrl}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Type': 'app',
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }).catch(() => {})
    }
    // 清理 LocalServer 中的 Hub 关联信息
    await stripHubInfo()
    await Promise.all([clearWebToken(), clearCachedSubscription()])
    eventBus.emit('auth:logout', {})
  }
}
