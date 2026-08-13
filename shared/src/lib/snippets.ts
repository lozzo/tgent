import { storage } from './storage'
import { webApi } from '../api/client'
import { AuthManager } from '../state/AuthManager'

const STORAGE_KEY = 'tgent-snippets'

export interface Snippet {
  id: string
  title: string
  content: string
  createdAt: number
}

export async function loadSnippets(): Promise<Snippet[]> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    try {
      const remoteList = await webApi.getSnippets()
      // 转换服务端格式（createdAt 为 ISO 字符串）到本地格式（createdAt 为 number）
      const snippets: Snippet[] = remoteList.map((s: any) => ({
        id: s.id,
        title: s.title,
        content: s.content,
        createdAt: typeof s.createdAt === 'number' ? s.createdAt : new Date(s.createdAt).getTime(),
      }))

      // 首次同步：远程为空且本地有数据时，上传本地数据
      if (snippets.length === 0) {
        const localRaw = await storage.get(STORAGE_KEY)
        if (localRaw) {
          const localList = JSON.parse(localRaw) as Snippet[]
          if (localList.length > 0) {
            for (const s of localList) {
              webApi.createSnippet(s.title, s.content).catch(() => {})
            }
            return localList
          }
        }
      }

      // 缓存到本地
      await storage.set(STORAGE_KEY, JSON.stringify(snippets))
      return snippets
    } catch {
      // 远程失败，降级本地
    }
  }

  try {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Snippet[]
  } catch {
    return []
  }
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    try {
      const created = await webApi.createSnippet(snippet.title, snippet.content)
      // 使用服务端返回的 id
      snippet.id = created.id
    } catch {
      // 远程失败，继续本地保存
    }
  }

  const list = await loadLocalSnippets()
  list.unshift(snippet)
  await storage.set(STORAGE_KEY, JSON.stringify(list))
}

export async function deleteSnippet(id: string): Promise<void> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    webApi.deleteSnippetRemote(id).catch(() => {})
  }

  const list = (await loadLocalSnippets()).filter(s => s.id !== id)
  await storage.set(STORAGE_KEY, JSON.stringify(list))
}

export async function updateSnippet(id: string, patch: Partial<Pick<Snippet, 'title' | 'content'>>): Promise<void> {
  const loggedIn = await AuthManager.getInstance().checkLoggedIn()
  if (loggedIn) {
    webApi.updateSnippet(id, patch).catch(() => {})
  }

  const list = (await loadLocalSnippets()).map(s => s.id === id ? { ...s, ...patch } : s)
  await storage.set(STORAGE_KEY, JSON.stringify(list))
}

export function createSnippetId(): string {
  return Date.now().toString(36)
}

// 仅从本地 storage 读取（避免递归调用 loadSnippets）
async function loadLocalSnippets(): Promise<Snippet[]> {
  try {
    const raw = await storage.get(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as Snippet[]
  } catch {
    return []
  }
}
