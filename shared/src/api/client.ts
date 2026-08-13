import { getWebToken, getWebUrl, clearWebToken } from '../lib/platform'
import type { LocalServer } from '../lib/localServers'
import type { WebRTCTransport } from './transport'
import { AuthManager } from '../state/AuthManager'
import { buildSignedAuthHeader, ed25519Sign, bytesToBase64, hasEd25519Key, sha256Hex } from './crypto'
import { storage } from '../lib/storage'
import {
  clearCachedSubscription,
  getCachedSubscription,
  setCachedSubscription,
} from '../lib/subscriptionCache'

export { getCachedSubscription, clearCachedSubscription }

// 从 types.ts 重新导出所有类型（保持外部 import 路径不变）
export type {
  Session,
  Window,
  Pane,
  AgentStatus,
  AgentInfo,
  UserInfo,
  SubscriptionInfo,
  WebRequestOptions,
  HubRequestOptions,
  ServerApi,
  TopologyApi,
  TerminalProtocolCapabilities,
  TerminalProvider,
  ProviderTopology,
  TerminalInfo,
} from './types'

import type {
  Session,
  Window,
  Pane,
  AgentStatus,
  AgentInfo,
  UserInfo,
  SubscriptionInfo,
  WebRequestOptions,
  HubRequestOptions,
  ServerApi,
  TopologyApi,
  TerminalProtocolCapabilities,
  TerminalProvider,
  ProviderTopology,
  TerminalInfo,
} from './types'

/** Encode an ID for use in URL path segments (handles %, @, etc.) */
function eid(id: string): string {
  return encodeURIComponent(id)
}

// ========== 共享请求基础设施 ==========

function isLikelyHtml(text: string): boolean {
  const lower = text.trim().toLowerCase()
  return lower.startsWith('<!doctype html') || lower.startsWith('<html')
}

async function parseErrorResponse(resp: Response): Promise<string> {
  const text = await resp.text().catch(() => '')
  if (text) {
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed?.error) return parsed.error
    } catch {
      // 非 JSON 文本错误，走下方兜底
    }
    if (isLikelyHtml(text)) return '服务响应异常，请检查网络或重新连接'
    return text.length > 200 ? text.slice(0, 200) : text
  }
  return resp.statusText || `HTTP ${resp.status}`
}

async function parseJsonResponse<T>(resp: Response): Promise<T> {
  if (resp.status === 204) return undefined as T
  const text = await resp.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    if (isLikelyHtml(text)) {
      throw new Error('服务响应异常，请检查网络或重新连接')
    }
    throw new Error('服务返回了无效数据')
  }
}

export class ApiRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

/** 通用 HTTP 请求：发送请求并解析响应 */
async function baseRequest<T>(url: string, method: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!resp.ok) {
    throw new ApiRequestError(resp.status, await parseErrorResponse(resp))
  }

  return parseJsonResponse<T>(resp)
}

// ========== 单机版请求 ==========

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return requestVersion<T>(1, method, path, body)
}

async function requestVersion<T>(version: 1 | 2, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = await storage.get('tgent_token')
  if (token) headers['Authorization'] = `Bearer ${token}`

  return baseRequest<T>(`/api/v${version}${path}`, method, headers, body)
}

// ========== Web 请求 ==========

/** Web 会话失效：清理 token，必要时跳转登录页 */
export async function handleWebSessionExpired(options?: WebRequestOptions) {
  await Promise.all([clearWebToken(), clearCachedSubscription()])
  if (!options?.silent) {
    window.location.href = '/login'
  }
}

/** 向 tgent-web 发送请求（Bearer token 认证） */
async function webRequest<T>(method: string, path: string, body?: unknown, options?: WebRequestOptions): Promise<T> {
  const webUrl = await getWebUrl()
  const baseUrl = `${webUrl}/api`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Type': 'app',
  }
  const token = await getWebToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (resp.status === 401) {
    if (options?.skipAuthRefresh) {
      throw new Error(await parseErrorResponse(resp))
    }

    const refreshResult = await tryRefreshToken()
    if (refreshResult === 1) {
      // 用新 token 重试原请求
      return webRequest(method, path, body, options)
    }
    if (refreshResult === 0) {
      // auth 确认过期，清除 token 并按需跳转登录
      await handleWebSessionExpired(options)
      throw new Error('session expired')
    }
    // refreshResult === -1: 网络/服务器错误，不当作 session 过期
    throw new Error('token refresh failed')
  }

  if (!resp.ok) {
    throw new Error(await parseErrorResponse(resp))
  }

  return parseJsonResponse<T>(resp)
}

let refreshPromise: Promise<number> | null = null

/** 尝试刷新 token（委托给 AuthManager 单例，供 WebRTC 等非 webRequest 调用使用）
 * @returns 1 = 刷新成功, 0 = auth 确认过期, -1 = 网络/服务器错误
 */
export async function tryRefreshToken(): Promise<number> {
  if (refreshPromise) return refreshPromise
  refreshPromise = AuthManager.getInstance().tryRefreshToken()
  const result = await refreshPromise
  refreshPromise = null
  return result
}

// ========== Hub 请求 ==========

/** 向远程 Hub 发送请求（使用指定的 hubUrl 和 hubToken，支持签名头） */
async function hubRequestWithParams<T>(method: string, path: string, opts: HubRequestOptions, body?: unknown): Promise<T> {
  const baseUrl = `${opts.hubUrl}/api/v1`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': await buildSignedAuthHeader(opts.hubToken),
  }

  // 端到端命令签名
  if (hasEd25519Key()) {
    const bodyStr = body ? JSON.stringify(body) : ''
    const bodyHash = await sha256Hex(bodyStr)
    const nonce = crypto.randomUUID()
    const timestamp = Math.floor(Date.now() / 1000)
    const message = `cmd:${method}:${path}:${bodyHash}:${nonce}:${timestamp}`
    const signature = await ed25519Sign(new TextEncoder().encode(message))

    headers['X-Command-Signature'] = bytesToBase64(signature)
    headers['X-Command-Nonce'] = nonce
    headers['X-Command-Timestamp'] = timestamp.toString()
  }

  return baseRequest<T>(`${baseUrl}${path}`, method, headers, body)
}

// ========== 单机版 API ==========

export const api = {
  login: (password: string) => request<{ token: string }>('POST', '/auth/login', { password }),
  topology: {
    capabilities: () => request<TerminalProtocolCapabilities>('GET', '/capabilities'),
    listProviders: () => requestVersion<TerminalProvider[]>(2, 'GET', '/providers'),
    getTopology: () => requestVersion<ProviderTopology[]>(2, 'GET', '/topology'),
    getTerminal: (terminalId: string) => requestVersion<TerminalInfo>(2, 'GET', `/terminals/${eid(terminalId)}`),
  } satisfies TopologyApi,
  status: () => request<{ tmux_running: boolean; sessions: number }>('GET', '/status'),
  agentStatus: () => request<AgentStatus>('GET', '/agent/status'),

  // Sessions
  listSessions: () => request<Session[]>('GET', '/sessions'),
  createSession: (name: string, cwd?: string) => request<Session>('POST', '/sessions', cwd ? { name, cwd } : { name }),
  deleteSession: (id: string) => request<void>('DELETE', `/sessions/${eid(id)}`),
  renameSession: (id: string, name: string) => request<void>('PUT', `/sessions/${eid(id)}/rename`, { name }),

  // Windows
  listWindows: (sessionId: string) => request<Window[]>('GET', `/sessions/${eid(sessionId)}/windows`),
  createWindow: (sessionId: string, name: string) => request<Window>('POST', `/sessions/${eid(sessionId)}/windows`, { name }),
  killWindow: (windowId: string) => request<void>('DELETE', `/windows/${eid(windowId)}`),
  renameWindow: (windowId: string, name: string) => request<void>('PUT', `/windows/${eid(windowId)}/rename`, { name }),
  moveWindow: (windowId: string, targetSession: string) => request<void>('PUT', `/windows/${eid(windowId)}/move`, { target_session: targetSession }),
  swapWindow: (windowId: string, targetWindowId: string) => request<void>('PUT', `/windows/${eid(windowId)}/swap`, { target_window_id: targetWindowId }),

  // Panes
  listPanes: (sessionId: string) => request<Pane[]>('GET', `/sessions/${eid(sessionId)}/panes`),
  splitPane: (paneId: string, horizontal: boolean) => request<Pane>('POST', `/panes/${eid(paneId)}/split`, { horizontal }),
  renamePane: (paneId: string, name: string) => request<void>('PUT', `/panes/${eid(paneId)}/rename`, { name }),
  killPane: (paneId: string) => request<void>('DELETE', `/panes/${eid(paneId)}`),
  movePane: (paneId: string, targetWindowId: string) => request<void>('PUT', `/panes/${eid(paneId)}/move`, { target_window_id: targetWindowId }),
  capturePane: (paneId: string) => request<{ pane_id: string; content: string }>('GET', `/panes/${eid(paneId)}/capture`),
}

// ========== 本地服务器 token 管理（仅用于 RTC 信令认证） ==========

const tokenCache = new Map<string, { token: string; obtainedAt: number }>()

/** 确保本地服务器有有效 token（用于 RTC 信令端点认证） */
export async function ensureLocalServerToken(server: LocalServer, overrideAddr?: string): Promise<string> {
  const cached = tokenCache.get(server.id)
  if (cached) {
    if (Date.now() - cached.obtainedAt > 3600_000) {
      tokenCache.delete(server.id)
    } else {
      return cached.token
    }
  }

  if (!server.password) return ''

  const addr = overrideAddr || server.addr
  if (!addr) return ''

  try {
    const loginResp = await fetch(`${addr}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: server.password }),
      signal: AbortSignal.timeout(8000),
    })
    if (loginResp.ok) {
      const { token } = await loginResp.json()
      tokenCache.set(server.id, { token, obtainedAt: Date.now() })
      return token
    }
  } catch (err) {
    console.warn(`[ensureLocalServerToken] fetch failed for ${server.addr}:`, err)
  }
  tokenCache.delete(server.id)
  return ''
}

// ========== tgent-web API ==========

/** tgent-web API - 用户认证和 Agent 管理 */
export const webApi = {
  login: (username: string, password: string) =>
    webRequest<{ token: string; refresh_token: string; user: UserInfo }>(
      'POST',
      '/auth/login',
      { username, password },
      { skipAuthRefresh: true }
    ),

  register: (username: string, email: string, password: string) =>
    webRequest<{ token: string; refresh_token: string; user: UserInfo }>(
      'POST',
      '/auth/register',
      { username, email, password },
      { skipAuthRefresh: true }
    ),

  getMe: async () => {
    const result = await webRequest<{ user: UserInfo; subscription: SubscriptionInfo | null }>('GET', '/auth/me')
    await setCachedSubscription(result.user.id, result.subscription)
    return result
  },

  // Agent 管理
  listAgents: () => webRequest<AgentInfo[]>('GET', '/agents'),
  updateAgent: (id: string, name: string) => webRequest<{ id: string; name: string }>('PUT', `/agents/${id}`, { name }),
  deleteAgent: (id: string) => webRequest<void>('DELETE', `/agents/${id}`),
  pairAgent: (id: string) => webRequest<{ id: string; paired: boolean }>('POST', `/agents/${id}/pair`),

  // 获取 Agent 连接信息（含 Hub token）
  getAgentConnectInfo: async (agentId: string) => {
    return webRequest<{ hubHttpUrl: string; agentId: string; hubToken: string; allowRelayTransfer: boolean }>('POST', `/agents/${agentId}/connect`)
  },

  // 获取 Agent 加密私钥
  getAgentEncryptedKey: (agentId: string) =>
    webRequest<{ encrypted_private_key: string; key_nonce: string }>('GET', `/agents/${agentId}/encrypted-key`),

  // 登出
  logout: (refreshToken?: string | null) =>
    webRequest<void>('POST', '/auth/logout', refreshToken ? { refresh_token: refreshToken } : {}, { silent: true }),

  // 快捷键配置
  getFnConfig: () => webRequest<{ config: any }>('GET', '/user/fn-config'),
  saveFnConfig: (config: any) => webRequest<{ config: any }>('PUT', '/user/fn-config', { config }),

  // 代码片段
  getSnippets: () => webRequest<any[]>('GET', '/user/snippets'),
  createSnippet: (title: string, content: string) => webRequest<any>('POST', '/user/snippets', { title, content }),
  updateSnippet: (id: string, patch: any) => webRequest<any>('PUT', `/user/snippets/${id}`, patch),
  deleteSnippetRemote: (id: string) => webRequest<void>('DELETE', `/user/snippets/${id}`),

  // 路径收藏
  getPathBookmarks: (agentId: string) => webRequest<any[]>('GET', `/user/path-bookmarks?agentId=${encodeURIComponent(agentId)}`),
  createPathBookmark: (agentId: string, path: string, name: string) => webRequest<any>('POST', '/user/path-bookmarks', { agentId, path, name }),
  updatePathBookmark: (id: string, patch: any) => webRequest<any>('PUT', `/user/path-bookmarks/${id}`, patch),
  deletePathBookmarkRemote: (id: string) => webRequest<void>('DELETE', `/user/path-bookmarks/${id}`),
}

// ========== Hub API（用于 WebRTC 连接代理） ==========

/** 创建服务器级别的 API 实例（代理到远程 Agent，通过 Hub） */
export function createServerApi(serverId: string, hubUrl: string, hubToken: string): ServerApi {
  const opts: HubRequestOptions = { hubUrl, hubToken }
  const prefix = `/servers/${serverId}`
  return {
    topology: {
      capabilities: () => hubRequestWithParams<TerminalProtocolCapabilities>('GET', `${prefix}/capabilities`, opts),
      listProviders: () => hubRequestWithParams<TerminalProvider[]>('GET', `${prefix}/providers`, opts),
      getTopology: () => hubRequestWithParams<ProviderTopology[]>('GET', `${prefix}/topology`, opts),
      getTerminal: (terminalId: string) => hubRequestWithParams<TerminalInfo>('GET', `${prefix}/terminals/${eid(terminalId)}`, opts),
    },
    status: () => hubRequestWithParams<{ tmux_running: boolean; sessions: number }>('GET', `${prefix}/status`, opts),

    listSessions: () => hubRequestWithParams<Session[]>('GET', `${prefix}/sessions`, opts),
    createSession: (name: string, cwd?: string) => hubRequestWithParams<Session>('POST', `${prefix}/sessions`, opts, cwd ? { name, cwd } : { name }),
    deleteSession: (id: string) => hubRequestWithParams<void>('DELETE', `${prefix}/sessions/${eid(id)}`, opts),
    renameSession: (id: string, name: string) => hubRequestWithParams<void>('PUT', `${prefix}/sessions/${eid(id)}/rename`, opts, { name }),

    listWindows: (sessionId: string) => hubRequestWithParams<Window[]>('GET', `${prefix}/sessions/${eid(sessionId)}/windows`, opts),
    createWindow: (sessionId: string, name: string) => hubRequestWithParams<Window>('POST', `${prefix}/sessions/${eid(sessionId)}/windows`, opts, { name }),
    killWindow: (windowId: string) => hubRequestWithParams<void>('DELETE', `${prefix}/windows/${eid(windowId)}`, opts),
    renameWindow: (windowId: string, name: string) => hubRequestWithParams<void>('PUT', `${prefix}/windows/${eid(windowId)}/rename`, opts, { name }),
    moveWindow: (windowId: string, targetSession: string) => hubRequestWithParams<void>('PUT', `${prefix}/windows/${eid(windowId)}/move`, opts, { target_session: targetSession }),
    swapWindow: (windowId: string, targetWindowId: string) => hubRequestWithParams<void>('PUT', `${prefix}/windows/${eid(windowId)}/swap`, opts, { target_window_id: targetWindowId }),

    listPanes: (sessionId: string) => hubRequestWithParams<Pane[]>('GET', `${prefix}/sessions/${eid(sessionId)}/panes`, opts),
    splitPane: (paneId: string, horizontal: boolean) => hubRequestWithParams<Pane>('POST', `${prefix}/panes/${eid(paneId)}/split`, opts, { horizontal }),
    renamePane: (paneId: string, name: string) => hubRequestWithParams<void>('PUT', `${prefix}/panes/${eid(paneId)}/rename`, opts, { name }),
    killPane: (paneId: string) => hubRequestWithParams<void>('DELETE', `${prefix}/panes/${eid(paneId)}`, opts),
    movePane: (paneId: string, targetWindowId: string) => hubRequestWithParams<void>('PUT', `${prefix}/panes/${eid(paneId)}/move`, opts, { target_window_id: targetWindowId }),
    capturePane: (paneId: string) => hubRequestWithParams<{ pane_id: string; content: string }>('GET', `${prefix}/panes/${eid(paneId)}/capture`, opts),
  }
}

/** 创建 P2P 模式的服务器 API 实例（通过 WebRTC DataChannel） */
export function createP2PServerApi(transport: WebRTCTransport): ServerApi {
  async function p2pRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await transport.sendApiRequest(method, path, body)
    if (resp.status >= 400) {
      const err = resp.body as { error?: string }
      throw new ApiRequestError(resp.status, err?.error || `P2P request failed: ${resp.status}`)
    }
    if (resp.status === 204) return undefined as T
    return resp.body as T
  }

  return {
    topology: {
      capabilities: () => p2pRequest<TerminalProtocolCapabilities>('GET', '/capabilities'),
      listProviders: () => p2pRequest<TerminalProvider[]>('GET', '/providers'),
      getTopology: () => p2pRequest<ProviderTopology[]>('GET', '/topology'),
      getTerminal: (terminalId: string) => p2pRequest<TerminalInfo>('GET', `/terminals/${eid(terminalId)}`),
    },
    status: () => p2pRequest<{ tmux_running: boolean; sessions: number }>('GET', '/status'),

    listSessions: () => p2pRequest<Session[]>('GET', '/sessions'),
    createSession: (name: string, cwd?: string) => p2pRequest<Session>('POST', '/sessions', cwd ? { name, cwd } : { name }),
    deleteSession: (id: string) => p2pRequest<void>('DELETE', `/sessions/${eid(id)}`),
    renameSession: (id: string, name: string) => p2pRequest<void>('PUT', `/sessions/${eid(id)}/rename`, { name }),

    listWindows: (sessionId: string) => p2pRequest<Window[]>('GET', `/sessions/${eid(sessionId)}/windows`),
    createWindow: (sessionId: string, name: string) => p2pRequest<Window>('POST', `/sessions/${eid(sessionId)}/windows`, { name }),
    killWindow: (windowId: string) => p2pRequest<void>('DELETE', `/windows/${eid(windowId)}`),
    renameWindow: (windowId: string, name: string) => p2pRequest<void>('PUT', `/windows/${eid(windowId)}/rename`, { name }),
    moveWindow: (windowId: string, targetSession: string) => p2pRequest<void>('PUT', `/windows/${eid(windowId)}/move`, { target_session: targetSession }),
    swapWindow: (windowId: string, targetWindowId: string) => p2pRequest<void>('PUT', `/windows/${eid(windowId)}/swap`, { target_window_id: targetWindowId }),

    listPanes: (sessionId: string) => p2pRequest<Pane[]>('GET', `/sessions/${eid(sessionId)}/panes`),
    splitPane: (paneId: string, horizontal: boolean) => p2pRequest<Pane>('POST', `/panes/${eid(paneId)}/split`, { horizontal }),
    renamePane: (paneId: string, name: string) => p2pRequest<void>('PUT', `/panes/${eid(paneId)}/rename`, { name }),
    killPane: (paneId: string) => p2pRequest<void>('DELETE', `/panes/${eid(paneId)}`),
    movePane: (paneId: string, targetWindowId: string) => p2pRequest<void>('PUT', `/panes/${eid(paneId)}/move`, { target_window_id: targetWindowId }),
    capturePane: (paneId: string) => p2pRequest<{ pane_id: string; content: string }>('GET', `/panes/${eid(paneId)}/capture`),
  }
}
