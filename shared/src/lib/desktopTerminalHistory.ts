import { storage } from './storage'

const LAST_SERVER_KEY = 'tgent_desktop_last_server'

interface DesktopTerminalHistory {
  paneId: string
  sessionName?: string
  openedAt: number
}

function historyKey(serverId: string): string {
  return `tgent_desktop_last_terminal:${serverId}`
}

export async function getDesktopTerminalHistory(serverId: string): Promise<DesktopTerminalHistory | null> {
  try {
    const raw = await storage.get(historyKey(serverId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<DesktopTerminalHistory>
    if (typeof value.paneId !== 'string' || !value.paneId) return null
    return {
      paneId: value.paneId,
      sessionName: typeof value.sessionName === 'string' ? value.sessionName : undefined,
      openedAt: typeof value.openedAt === 'number' ? value.openedAt : 0,
    }
  } catch {
    return null
  }
}

export async function getDesktopLastServerId(): Promise<string | null> {
  try {
    const serverId = await storage.get(LAST_SERVER_KEY)
    return serverId?.trim() || null
  } catch {
    return null
  }
}

export async function rememberDesktopTerminal(serverId: string, paneId: string, sessionName?: string): Promise<void> {
  if (!serverId || !paneId) return
  try {
    await Promise.all([
      storage.set(historyKey(serverId), JSON.stringify({
        paneId,
        sessionName: sessionName || undefined,
        openedAt: Date.now(),
      } satisfies DesktopTerminalHistory)),
      storage.set(LAST_SERVER_KEY, serverId),
    ])
  } catch {}
}
