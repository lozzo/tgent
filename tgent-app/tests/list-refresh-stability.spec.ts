import { test, expect } from '@playwright/test'

test.describe('实时列表稳定性', () => {
  test('高频 tmux 结构事件只触发一次静默对账', async ({ page }) => {
    await page.goto('/#/welcome')

    const result = await page.evaluate(async () => {
      const modulePath = '/src/state/AgentDataStore.ts'
      const { AgentDataStore } = await import(modulePath)
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

      let listCalls = 0
      let statusCalls = 0
      let snapshot = [
        { id: '$1', name: 'stable', windows: 1, created: '1' },
      ]
      let emitEvent: ((event: Record<string, string>) => void) | undefined

      const api = {
        listSessions: async () => {
          listCalls++
          return snapshot.map(session => ({ ...session }))
        },
        status: async () => {
          statusCalls++
          return { tmux_running: true, sessions: snapshot.length }
        },
        listWindows: async () => [],
        listPanes: async () => [],
      }
      const transport = {
        subscribeEvent: (callback: (event: Record<string, string>) => void) => {
          emitEvent = callback
          return () => { emitEvent = undefined }
        },
      }

      const store = new AgentDataStore()
      store.bind(api as never, transport as never)
      while (listCalls < 1 || store.loading) await delay(5)

      const stableNode = store.sessions[0]
      let notifications = 0
      store.subscribeData(() => { notifications++ })
      snapshot = [
        { id: '$1', name: 'stable', windows: 1, created: '1' },
        { id: '$2', name: 'final', windows: 1, created: '2' },
      ]

      for (let i = 0; i < 100; i++) {
        emitEvent?.({
          type: i % 2 === 0 ? 'session_created' : 'session_closed',
          session_id: `$rapid-${i}`,
        })
      }

      await delay(100)
      const duringBurst = {
        listCalls,
        sessionCount: store.sessions.length,
        stableNode: store.sessions[0] === stableNode,
        notifications,
      }

      await delay(350)
      const afterQuiet = {
        listCalls,
        statusCalls,
        sessionCount: store.sessions.length,
        stableNode: store.sessions[0] === stableNode,
        notifications,
      }
      store.destroy()

      return { duringBurst, afterQuiet }
    })

    expect(result.duringBurst).toEqual({
      listCalls: 1,
      sessionCount: 1,
      stableNode: true,
      notifications: 0,
    })
    expect(result.afterQuiet.listCalls).toBe(2)
    expect(result.afterQuiet.statusCalls).toBe(2)
    expect(result.afterQuiet.sessionCount).toBe(2)
    expect(result.afterQuiet.stableNode).toBe(true)
    expect(result.afterQuiet.notifications).toBe(1)
  })

  test('机器列表对账保留卡片和本地在线状态', async ({ page }) => {
    await page.goto('/#/welcome')

    const result = await page.evaluate(async () => {
      const modulePath = '/src/hooks/useServerList.ts'
      const { reconcileServerCards } = await import(modulePath)
      const previous = [{
        type: 'local' as const,
        id: 'machine-1',
        name: 'Machine 1',
        addr: 'http://192.168.1.8:8080',
        online: 'online' as const,
        localServer: { id: 'machine-1', name: 'Machine 1', addr: 'http://192.168.1.8:8080' },
      }]
      const incoming = [{
        type: 'local' as const,
        id: 'machine-1',
        name: 'Machine 1',
        addr: 'http://192.168.1.8:8080',
        online: 'checking' as const,
        localServer: { id: 'machine-1', name: 'Machine 1', addr: 'http://192.168.1.8:8080' },
      }]
      const next = reconcileServerCards(previous, incoming)
      return {
        arrayStable: next === previous,
        cardStable: next[0] === previous[0],
        online: next[0].online,
      }
    })

    expect(result).toEqual({ arrayStable: true, cardStable: true, online: 'online' })
  })
})
