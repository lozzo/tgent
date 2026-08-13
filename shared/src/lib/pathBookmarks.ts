import { storage } from './storage'
import { webApi } from '../api/client'
import { AuthManager } from '../state/AuthManager'

const STORAGE_KEY_PREFIX = 'tgent-path-bookmarks'

function storageKey(serverId: string): string {
  return `${STORAGE_KEY_PREFIX}:${serverId}`
}

export interface PathBookmark {
  id: string
  path: string
  name: string
  createdAt: number
}

export async function loadPathBookmarks(serverId: string): Promise<PathBookmark[]> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    try {
      const remoteList = await webApi.getPathBookmarks(serverId)
      const bookmarks: PathBookmark[] = remoteList.map((b: any) => ({
        id: b.id,
        path: b.path,
        name: b.name,
        createdAt: typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt).getTime(),
      }))

      // 首次同步：远程为空且本地有数据时，上传本地数据
      if (bookmarks.length === 0) {
        const localRaw = await storage.get(storageKey(serverId))
        if (localRaw) {
          const localList = JSON.parse(localRaw) as PathBookmark[]
          if (localList.length > 0) {
            for (const b of localList) {
              webApi.createPathBookmark(serverId, b.path, b.name).catch(() => {})
            }
            return localList
          }
        }
      }

      // 缓存到本地
      await storage.set(storageKey(serverId), JSON.stringify(bookmarks))
      return bookmarks
    } catch {
      // 远程失败，降级本地
    }
  }

  try {
    const raw = await storage.get(storageKey(serverId))
    if (!raw) return []
    return JSON.parse(raw) as PathBookmark[]
  } catch {
    return []
  }
}

export async function savePathBookmark(serverId: string, bookmark: PathBookmark): Promise<void> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    try {
      const created = await webApi.createPathBookmark(serverId, bookmark.path, bookmark.name)
      bookmark.id = created.id
    } catch {
      // 远程失败，继续本地保存
    }
  }

  const list = await loadLocalBookmarks(serverId)
  list.unshift(bookmark)
  await storage.set(storageKey(serverId), JSON.stringify(list))
}

export async function deletePathBookmark(serverId: string, id: string): Promise<void> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    webApi.deletePathBookmarkRemote(id).catch(() => {})
  }

  const list = (await loadLocalBookmarks(serverId)).filter(b => b.id !== id)
  await storage.set(storageKey(serverId), JSON.stringify(list))
}

export async function updatePathBookmark(serverId: string, id: string, patch: Partial<Pick<PathBookmark, 'name' | 'path'>>): Promise<void> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    webApi.updatePathBookmark(id, patch).catch(() => {})
  }

  const list = (await loadLocalBookmarks(serverId)).map(b => b.id === id ? { ...b, ...patch } : b)
  await storage.set(storageKey(serverId), JSON.stringify(list))
}

export function createBookmarkId(): string {
  return Date.now().toString(36)
}

// 仅从本地 storage 读取
async function loadLocalBookmarks(serverId: string): Promise<PathBookmark[]> {
  try {
    const raw = await storage.get(storageKey(serverId))
    if (!raw) return []
    return JSON.parse(raw) as PathBookmark[]
  } catch {
    return []
  }
}
