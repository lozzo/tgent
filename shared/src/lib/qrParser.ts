/**
 * QR 码数据解析模块
 * 纯函数，无副作用，方便测试
 */

/** QR 码解析后的结构化结果 */
export interface QRParseResult {
  name?: string
  local?: {
    addrs?: string[]
    password?: string
  }
  hub?: {
    addr?: string
    agentId?: string
    privateKey?: string
    pairCode?: string
    apiUrl?: string
  }
}

/** 解析结果转换为 LocalServer 所需的数据 */
export interface QRServerData {
  name: string
  addr: string
  password: string
  hubAddr?: string
  hubAgentId?: string
  localAddrs?: string[]
  privateKeySeed?: string
  pairCode?: string
}

function normalizeAddr(addr?: string): string | undefined {
  const trimmed = addr?.trim().replace(/\/+$/, '')
  return trimmed || undefined
}

function normalizeAddrs(addrs?: string[]): string[] | undefined {
  if (!addrs?.length) return undefined
  const normalized = addrs
    .map((addr) => normalizeAddr(addr))
    .filter((addr): addr is string => !!addr)
  return normalized.length ? Array.from(new Set(normalized)) : undefined
}

/** Decompress raw DEFLATE data using DecompressionStream API */
async function decompressFlate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw' as CompressionFormat)
  const writer = ds.writable.getWriter()
  writer.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength) as unknown as BufferSource)
  writer.close()
  const reader = ds.readable.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const totalLen = chunks.reduce((s, c) => s + c.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/**
 * 解析 QR 码内容，返回结构化数据
 * 支持新格式 tgent://<base64url(flate(JSON))> 和旧格式 tgent:<base64(JSON)>
 * 返回 null 表示不是有效的 tgent QR 码
 */
export async function parseQRCode(content: string): Promise<QRParseResult | null> {
  // QR 码原始 JSON 结构（新格式字段缩写 + 旧格式字段兼容）
  let info: {
    n?: string   // name
    l?: { a?: string[]; p?: string }  // local: addrs, password
    h?: { a?: string; i?: string; p?: string; k?: string; u?: string }  // hub: addr, agent_id, pair_code, decrypt_key(legacy), api_url
    // 旧格式字段
    name?: string
    local?: { addrs?: string[]; password?: string }
    hub?: { addr?: string; agent_id?: string; private_key?: string; decrypt_key?: string; api_url?: string }
  }

  if (content.startsWith('tgent://')) {
    // 新格式：flate 压缩 + base64url
    const b64 = content.slice('tgent://'.length)
    const compressed = Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const decompressed = await decompressFlate(compressed)
    info = JSON.parse(new TextDecoder().decode(decompressed))
  } else if (content.startsWith('tgent:')) {
    // 旧格式：纯 base64 JSON
    const b64 = content.slice('tgent:'.length)
    info = JSON.parse(atob(b64))
  } else {
    return null
  }

  // 统一字段（兼容新旧格式）
  const local = info.l
    ? { addrs: normalizeAddrs(info.l.a), password: info.l.p }
    : info.local
      ? { addrs: normalizeAddrs(info.local.addrs), password: info.local.password }
      : undefined

  const hub = info.h
    ? { addr: normalizeAddr(info.h.a), agentId: info.h.i, pairCode: info.h.p, apiUrl: normalizeAddr(info.h.u) }
    : info.hub
      ? {
          addr: normalizeAddr(info.hub.addr),
          agentId: info.hub.agent_id,
          privateKey: info.hub.private_key,
          apiUrl: normalizeAddr(info.hub.api_url),
        }
      : undefined

  return {
    name: info.n || info.name,
    local: local ? { addrs: local.addrs, password: local.password } : undefined,
    hub,
  }
}

/** 检查解析结果是否有本地连接信息 */
export function hasLocalInfo(result: QRParseResult): boolean {
  return !!(result.local?.addrs?.length)
}

/** 检查解析结果是否有 Hub 连接信息 */
export function hasHubInfo(result: QRParseResult): boolean {
  return !!(result.hub?.addr && result.hub?.agentId)
}

/**
 * 将 QRParseResult 转换为可用于 addOrUpdateByHubAgentId 的服务器数据
 * @param result QR 解析结果
 * @param workingAddr 探测成功的本地地址（可为空）
 */
export function toServerData(result: QRParseResult, workingAddr: string | null): QRServerData {
  const hasLocal = hasLocalInfo(result)
  const hasHub = hasHubInfo(result)

  const name = result.name
    || (workingAddr ? workingAddr.replace(/^https?:\/\//, '').split(':')[0] : '')
    || result.hub?.agentId
    || 'unknown'

  return {
    name,
    addr: workingAddr || '',
    password: result.local?.password || '',
    hubAddr: hasHub ? result.hub!.addr! : undefined,
    hubAgentId: hasHub ? result.hub!.agentId! : undefined,
    localAddrs: hasLocal ? result.local!.addrs! : undefined,
    privateKeySeed: result.hub?.privateKey || undefined,
    pairCode: result.hub?.pairCode || undefined,
  }
}

/**
 * 将 QRParseResult 转换为仅包含本地连接信息的服务器数据（不含任何 hub 字段）
 * 用于扫到 both/hub 码但不应保存 hub 信息的场景（未登录、不是自己的 agent 等）
 */
export function toLocalOnlyServerData(result: QRParseResult, workingAddr: string | null): QRServerData {
  const name = result.name
    || (workingAddr ? workingAddr.replace(/^https?:\/\//, '').split(':')[0] : '')
    || 'unknown'
  return {
    name,
    addr: workingAddr || '',
    password: result.local?.password || '',
    localAddrs: hasLocalInfo(result) ? result.local!.addrs! : undefined,
  }
}

/** 并发探测所有地址，返回第一个可达的地址 */
export function probeAddresses(addrs: string[]): Promise<string | null> {
  const candidates = normalizeAddrs(addrs) || []
  return new Promise((resolve) => {
    let settled = false
    let pending = candidates.length

    if (!pending) {
      resolve(null)
      return
    }

    candidates.forEach(async (addr) => {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 5000)
        const resp = await fetch(`${addr}/api/v1/status`, { signal: ctrl.signal, mode: 'cors' })
        clearTimeout(timer)
        if ((resp.ok || resp.status === 401) && !settled) {
          settled = true
          resolve(addr)
          return
        }
      } catch {}
      pending--
      if (pending <= 0 && !settled) { settled = true; resolve(null) }
    })
  })
}
