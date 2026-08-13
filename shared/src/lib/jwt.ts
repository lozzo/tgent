/**
 * JWT 工具函数
 */

/**
 * 判断 JWT token 是否仍然有效（未过期且距过期还有足够余量）
 * @param token JWT token 字符串
 * @param marginMs 安全余量（毫秒），默认 5 分钟
 */
export function isJwtValid(token: string, marginMs = 300_000): boolean {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof payload.exp !== 'number') return false
    return payload.exp * 1000 - Date.now() > marginMs
  } catch {
    return false
  }
}
