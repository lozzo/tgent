/**
 * 根据 serverId 推断 serverType
 * - 有 serverId 且在 localServers 中找到 → 'local'
 * - 有 serverId 但不在 localServers 中 → 'hub'
 * - 无 serverId → 'direct'
 */
import { findLocalServerById } from './localServers'

export async function resolveServerType(serverId?: string): Promise<'local' | 'hub' | 'direct'> {
  if (!serverId) return 'direct'
  const local = await findLocalServerById(serverId)
  return local ? 'local' : 'hub'
}
