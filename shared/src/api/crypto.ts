// Ed25519 签名工具（使用 Web Crypto API）

let cachedKeyPair: { privateKey: CryptoKey; publicKey: Uint8Array; seed: Uint8Array } | null = null

/** 从 base64 编码的 seed（32 bytes）导入 Ed25519 私钥 */
export async function importEd25519Seed(seedB64: string): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array; seed: Uint8Array }> {
  const seed = base64ToBytes(seedB64)
  if (seed.length !== 32) {
    throw new Error('Ed25519 seed must be 32 bytes')
  }

  // Web Crypto 使用 PKCS8 格式导入 Ed25519 密钥
  // Ed25519 PKCS8 格式: ASN.1 前缀 + seed
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ])
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + seed.length)
  pkcs8.set(pkcs8Prefix)
  pkcs8.set(seed, pkcs8Prefix.length)

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'Ed25519' },
    true,
    ['sign']
  )

  // 导出公钥
  const keyPair = await derivePublicKey(privateKey)

  return { privateKey, publicKey: keyPair, seed }
}

/** 从私钥导出公钥 bytes */
async function derivePublicKey(privateKey: CryptoKey): Promise<Uint8Array> {
  // 通过签名来获取不行，我们需要通过 exportKey 来获取
  // Web Crypto Ed25519 不支持直接从私钥导出公钥
  // 使用签名+验证的方式来验证，但实际上我们需要另一种方式
  // 使用 JWK 导出然后提取 x 参数
  const jwk = await crypto.subtle.exportKey('jwk', privateKey) as JsonWebKey & { x?: string }
  if (jwk.x) {
    return base64urlToBytes(jwk.x)
  }
  throw new Error('failed to derive public key')
}

/** 使用缓存的密钥对进行签名 */
export async function ed25519Sign(message: Uint8Array): Promise<Uint8Array> {
  if (!cachedKeyPair) {
    throw new Error('Ed25519 key not loaded. Call loadEd25519Key first.')
  }
  const signature = await crypto.subtle.sign('Ed25519', cachedKeyPair.privateKey, message.buffer as ArrayBuffer)
  return new Uint8Array(signature)
}

/** 加载并缓存 Ed25519 密钥 */
export async function loadEd25519Key(seedB64: string): Promise<void> {
  cachedKeyPair = await importEd25519Seed(seedB64)
}

/** 检查是否已加载密钥 */
export function hasEd25519Key(): boolean {
  return cachedKeyPair !== null
}

/** 获取缓存的公钥 bytes */
export function getEd25519PublicKey(): Uint8Array | null {
  return cachedKeyPair?.publicKey ?? null
}

/** 构造签名头: Bearer <jwt>::<timestamp>::<base64_signature> */
export async function buildSignedAuthHeader(jwt: string): Promise<string> {
  if (!cachedKeyPair) {
    // 没有密钥，降级为普通 Bearer token
    return `Bearer ${jwt}`
  }
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const message = new TextEncoder().encode(`${jwt}:${timestamp}`)
  const signature = await ed25519Sign(message)
  const signatureB64 = bytesToBase64(signature)
  return `Bearer ${jwt}::${timestamp}::${signatureB64}`
}

// ========== Base64 工具 ==========

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64urlToBytes(b64url: string): Uint8Array {
  // base64url → standard base64
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4 !== 0) {
    b64 += '='
  }
  return base64ToBytes(b64)
}

// ========== AES-GCM 解密 ==========

/** 使用 PBKDF2-SHA256 从配对码 + agentId 派生 AES-256 密钥 */
export async function deriveAesKeyFromPairCode(pairCode: string, agentId: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pairCode),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(agentId),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )
}

/** 使用配对码解密 AES-256-GCM 加密的数据 */
export async function decryptWithPairCode(encryptedB64: string, nonceB64: string, pairCode: string, agentId: string): Promise<Uint8Array> {
  const encrypted = base64ToBytes(encryptedB64)
  const nonce = base64ToBytes(nonceB64)
  const key = await deriveAesKeyFromPairCode(pairCode, agentId)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as Uint8Array<ArrayBuffer> },
    key,
    encrypted.buffer as ArrayBuffer
  )

  return new Uint8Array(decrypted)
}

// ========== 命令签名工具 ==========

/** 计算字符串的 SHA256 哈希（十六进制） */
export async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 计算 bytes 的 SHA256 哈希（十六进制） */
export async function sha256HexBytes(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 通用签名辅助函数 */
export async function signCommand(type: string, fields: string[]): Promise<{ signature: string; nonce: string; timestamp: number }> {
  const nonce = crypto.randomUUID()
  const timestamp = Math.floor(Date.now() / 1000)
  const message = `${type}:${fields.join(':')}:${nonce}:${timestamp}`
  const signature = await ed25519Sign(new TextEncoder().encode(message))
  return {
    signature: bytesToBase64(signature),
    nonce,
    timestamp,
  }
}
