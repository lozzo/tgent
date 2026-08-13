import { storage } from './storage'

const STORAGE_KEY = 'tgent_local_servers'
const SERVERS_CACHE_KEY = 'tgent_servers_cache'
export const LOCAL_SERVERS_CHANGE_EVENT = 'tgent-local-servers-change'
export const CONNECTION_COLOR_OPTIONS = [
  '#4f7dff',
  '#24a875',
  '#d28b2c',
  '#d85a67',
  '#8b6bd8',
  '#1e9db2',
  '#c45c9a',
  '#6f7782',
] as const

export interface LocalServer {
  id: string
  name: string
  addr: string         // 本地地址（online 模式为空字符串）
  password: string
  addedAt: number
  socketPath?: string  // 桌面端同用户本地 Socket；连接时不需要 Web 密码
  hubAddr?: string     // Hub 服务器地址
  hubAgentId?: string  // Hub 中的 agent ID
  localAddrs?: string[] // 扫码时获取的所有本地地址（用于重试）
  privateKeySeed?: string // base64 Ed25519 种子（从 QR 码获取）
  pairCode?: string       // 16 字符可读配对码（用于 PBKDF2 派生 AES 密钥解密私钥）
  disabled?: boolean      // 保留连接与配对信息，但不在连接入口中使用
  color?: string          // 桌面端连接识别色
}

function normalizedConnectionColor(color?: string): string | undefined {
  const value = color?.trim().toLowerCase()
  return value && /^#[0-9a-f]{6}$/.test(value) ? value : undefined
}

export function connectionColorForKey(key: string): string {
  let hash = 2166136261
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return CONNECTION_COLOR_OPTIONS[Math.abs(hash) % CONNECTION_COLOR_OPTIONS.length]
}

export function getConnectionColor(server: Pick<LocalServer, 'id' | 'name' | 'addr' | 'socketPath' | 'hubAgentId' | 'color'>): string {
  return normalizedConnectionColor(server.color)
    || connectionColorForKey(server.hubAgentId || server.socketPath || server.addr || server.name || server.id)
}

async function load(): Promise<LocalServer[]> {
  try {
    const raw = await storage.get(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

async function save(servers: LocalServer[]): Promise<void> {
  await storage.set(STORAGE_KEY, JSON.stringify(servers))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LOCAL_SERVERS_CHANGE_EVENT, { detail: servers }))
  }
}

export async function getLocalServers(): Promise<LocalServer[]> {
  return load()
}

export async function addLocalServer(server: Omit<LocalServer, 'id' | 'addedAt'>): Promise<LocalServer> {
  const servers = await load()
  const newServer: LocalServer = {
    ...server,
    id: self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36),
    addedAt: Date.now(),
  }
  newServer.color = normalizedConnectionColor(newServer.color) || getConnectionColor(newServer)
  servers.push(newServer)
  await save(servers)
  return newServer
}

export async function removeLocalServer(id: string): Promise<void> {
  const servers = (await load()).filter(s => s.id !== id)
  await save(servers)
}

/** 移除所有纯 hub 类型的服务器记录（无本地地址，仅有 hubAgentId） */
export async function removeHubOnlyServers(): Promise<void> {
  const servers = (await load()).filter(s => {
    const isHubOnly = !s.socketPath && !s.addr && !s.localAddrs?.length && !!s.hubAgentId
    return !isHubOnly
  })
  await save(servers)
}

export async function updateLocalServer(id: string, patch: Partial<Pick<LocalServer, 'name' | 'addr' | 'password' | 'socketPath' | 'hubAddr' | 'hubAgentId' | 'localAddrs' | 'privateKeySeed' | 'pairCode' | 'disabled' | 'color'>>): Promise<void> {
  const servers = (await load()).map(s => s.id === id ? { ...s, ...patch } : s)
  await save(servers)
}

export async function findLocalServerById(id: string): Promise<LocalServer | undefined> {
  return (await load()).find(s => s.id === id)
}

export async function findByHubAgentId(hubAgentId: string): Promise<LocalServer | undefined> {
  return (await load()).find(s => s.hubAgentId === hubAgentId)
}

function normalizeAddr(addr: string): string {
  return addr.trim().replace(/\/+$/, '')
}

function sortedAddrs(server: Pick<LocalServer, 'addr' | 'localAddrs'>): string[] {
  const fromLocalAddrs = (server.localAddrs || [])
    .map(normalizeAddr)
    .filter(Boolean)
  const fromAddr = server.addr ? [normalizeAddr(server.addr)] : []
  return Array.from(new Set([...fromLocalAddrs, ...fromAddr])).sort()
}

function localOnlyFingerprint(server: Pick<LocalServer, 'name' | 'password' | 'addr' | 'localAddrs' | 'socketPath'>): string {
  const name = server.name.trim().toLowerCase()
  const password = server.password || ''
  const addrs = sortedAddrs(server).join('|')
  return `${name}::${password}::${server.socketPath || ''}::${addrs}`
}

function mergeServerRecords(
  primary: LocalServer,
  related: LocalServer[],
  incoming?: Omit<LocalServer, 'id' | 'addedAt'>,
): LocalServer {
  const records = [primary, ...related]
  const first = <K extends keyof LocalServer>(key: K): LocalServer[K] | undefined => {
    const incomingValue = (incoming as Partial<LocalServer> | undefined)?.[key]
    if (incomingValue !== undefined && incomingValue !== '' && incomingValue !== false) return incomingValue
    return records.map(record => record[key]).find(value => value !== undefined && value !== '' && value !== false)
  }
  const localAddrs = Array.from(new Set([
    ...(incoming?.localAddrs || []),
    ...records.flatMap(record => record.localAddrs || []),
  ].map(normalizeAddr).filter(Boolean)))
  const disabled = incoming?.disabled
    ?? ((incoming?.privateKeySeed || incoming?.pairCode) ? false : primary.disabled)
    ?? related.every(record => record.disabled === true)
  const merged: LocalServer = {
    ...primary,
    name: primary.name || incoming?.name || first('name') || 'TGent',
    addr: (incoming?.addr || first('addr') || '') as string,
    password: (incoming?.password || first('password') || '') as string,
    addedAt: Math.min(...records.map(record => record.addedAt)),
    socketPath: (incoming?.socketPath || first('socketPath')) as string | undefined,
    hubAddr: (incoming?.hubAddr || first('hubAddr')) as string | undefined,
    hubAgentId: (incoming?.hubAgentId || first('hubAgentId')) as string | undefined,
    privateKeySeed: (incoming?.privateKeySeed || first('privateKeySeed')) as string | undefined,
    pairCode: (incoming?.pairCode || first('pairCode')) as string | undefined,
    disabled,
    color: normalizedConnectionColor(primary.color)
      || related.map(record => normalizedConnectionColor(record.color)).find(Boolean)
      || normalizedConnectionColor(incoming?.color),
  }
  if (localAddrs.length) merged.localAddrs = localAddrs
  else delete merged.localAddrs
  merged.color = merged.color || getConnectionColor(merged)
  return merged
}

/** Attach Hub identity to a direct endpoint and collapse any cloud-only duplicate. */
export async function attachHubIdentity(serverId: string, hubAgentId: string, hubAddr?: string): Promise<LocalServer | undefined> {
  if (!hubAgentId) return findLocalServerById(serverId)
  const servers = await load()
  const primary = servers.find(server => server.id === serverId)
  if (!primary) return undefined
  const related = servers.filter(server => server.id !== serverId && server.hubAgentId === hubAgentId)
  const merged = mergeServerRecords(primary, related, {
    name: primary.name,
    addr: primary.addr,
    password: primary.password,
    socketPath: primary.socketPath,
    localAddrs: primary.localAddrs,
    color: primary.color,
    disabled: primary.disabled,
    hubAgentId,
    hubAddr: hubAddr || primary.hubAddr,
  })
  await save(servers
    .filter(server => server.id === serverId || !related.some(candidate => candidate.id === server.id))
    .map(server => server.id === serverId ? merged : server))
  return merged
}

/** 按 hubAgentId 去重：已有则更新，没有则新增 */
export async function addOrUpdateByHubAgentId(
  server: Omit<LocalServer, 'id' | 'addedAt'>
): Promise<LocalServer> {
  const allServers = await load()
  const targetAddresses = sortedAddrs(server)
  const targetKey = localOnlyFingerprint(server)
  const localExisting = allServers.find(s => {
    if (server.socketPath && s.socketPath === server.socketPath) return true
    const existingAddresses = sortedAddrs(s)
    if (targetAddresses.some(address => existingAddresses.includes(address))) return true
    if (s.hubAgentId) return false
    return localOnlyFingerprint(s) === targetKey
  })
  const hubExisting = server.hubAgentId
    ? allServers.find(existing => existing.hubAgentId === server.hubAgentId)
    : undefined
  const primary = localExisting || hubExisting
  if (primary) {
    const related = allServers.filter(existing => existing.id !== primary.id && (
      existing.id === localExisting?.id
      || existing.id === hubExisting?.id
      || (!!server.hubAgentId && existing.hubAgentId === server.hubAgentId)
    ))
    const merged = mergeServerRecords(primary, related, server)
    await save(allServers
      .filter(existing => existing.id === primary.id || !related.some(candidate => candidate.id === existing.id))
      .map(existing => existing.id === primary.id ? merged : existing))
    return merged
  }

  return addLocalServer(server)
}

/**
 * 登出时清理所有 LocalServer 的 Hub 关联信息
 * - 纯 Hub 服务器（无 addr 且无 localAddrs，仅有 hubAgentId）→ 整条删除
 * - 混合服务器（有本地地址 + 有 hubAgentId）→ 清除 hubAgentId/hubAddr/privateKeySeed/pairCode
 */
export async function stripHubInfo(): Promise<void> {
  const servers = await load()
  const cleaned = servers
    .filter(s => {
      // 移除纯 Hub 服务器（无任何本地连接方式）
      const isHubOnly = !s.socketPath && !s.addr && (!s.localAddrs || s.localAddrs.length === 0) && !!s.hubAgentId
      return !isHubOnly
    })
    .map(s => {
      if (!s.hubAgentId) return s
      // 清除 Hub 关联字段，保留本地信息
      const copy = { ...s }
      delete copy.hubAgentId
      delete copy.hubAddr
      delete copy.privateKeySeed
      delete copy.pairCode
      return copy
    })
  await save(cleaned)
  // 清除服务器缓存，防止残留旧数据
  await storage.remove(SERVERS_CACHE_KEY)
}
