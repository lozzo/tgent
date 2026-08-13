import { storage } from './storage'
import { getLocalServers } from './localServers'

export interface FavoritePane {
  id: string              // crypto.randomUUID()
  serverId: string        // Agent id
  serverType: 'local' | 'hub'
  serverName: string      // 显示用
  paneId: string          // tmux pane id (e.g. "%0")
  sessionName: string
  windowName: string
  paneCommand: string
  addedAt: number
}

const STORAGE_KEY = 'tgent_favorite_panes'
const SERVERS_CACHE_KEY = 'tgent_servers_cache'

export async function loadFavorites(): Promise<FavoritePane[]> {
  try {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as FavoritePane[]
  } catch {
    return []
  }
}

export async function saveFavorites(favorites: FavoritePane[]): Promise<void> {
  try {
    await storage.set(STORAGE_KEY, JSON.stringify(favorites))
  } catch {}
}

export async function addFavorite(fav: Omit<FavoritePane, 'id' | 'addedAt'>): Promise<FavoritePane> {
  const favorites = await loadFavorites()
  const newFav: FavoritePane = {
    ...fav,
    id: self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36),
    addedAt: Date.now(),
  }
  favorites.push(newFav)
  await saveFavorites(favorites)
  return newFav
}

export async function removeFavorite(serverId: string, paneId: string): Promise<void> {
  const favorites = (await loadFavorites()).filter(
    f => !(f.serverId === serverId && f.paneId === paneId),
  )
  await saveFavorites(favorites)
}

export async function pruneMissingAgentFavorites(favorites: FavoritePane[]): Promise<FavoritePane[]> {
  if (favorites.length === 0) return favorites

  const existingIds = new Set<string>()
  const locals = await getLocalServers()
  for (const server of locals) {
    existingIds.add(server.id)
    if (server.hubAgentId) existingIds.add(server.hubAgentId)
  }

  try {
    const raw = await storage.get(SERVERS_CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw) as { id?: string; localServer?: { hubAgentId?: string } }[]
      for (const server of cached) {
        if (server.id) existingIds.add(server.id)
        if (server.localServer?.hubAgentId) existingIds.add(server.localServer.hubAgentId)
      }
    }
  } catch {}

  const pruned = favorites.filter(f => existingIds.has(f.serverId))
  if (pruned.length !== favorites.length) await saveFavorites(pruned)
  return pruned
}

export function isFavorite(favorites: FavoritePane[], serverId: string, paneId: string): boolean {
  return favorites.some(f => f.serverId === serverId && f.paneId === paneId)
}
