import { test, expect } from '@playwright/test'
import { NativeTransportProxy } from '../../shared/src/api/NativeTransportProxy'
import type { NativeConnectionInfo } from '../../shared/src/plugins/nativeConnection'
import { NativeBridgeClient, type BridgeSocket } from '../../shared/src/state/NativeBridgeClient'

class FakeBridge {
  isConnected = true
  generation = 1
  private handlers = new Map<number, Set<(payload: Uint8Array) => void>>()

  async openChannel(_label: string): Promise<number> {
    return 17
  }

  onChannelData(channelId: number, handler: (payload: Uint8Array) => void): () => void {
    const handlers = this.handlers.get(channelId) ?? new Set()
    handlers.add(handler)
    this.handlers.set(channelId, handlers)
    return () => {
      handlers.delete(handler)
      if (!handlers.size) this.handlers.delete(channelId)
    }
  }

  closeChannelByLabel(_label: string): void {
    this.handlers.delete(17)
  }

  emit(payload: Uint8Array): void {
    for (const handler of this.handlers.get(17) ?? []) handler(payload)
  }

  handlerCount(): number {
    return this.handlers.get(17)?.size ?? 0
  }
}

const flushChannelOpen = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test('reopening a native terminal channel delivers each PTY frame once', async () => {
  const bridge = new FakeBridge()
  const proxy = new NativeTransportProxy(
    bridge as unknown as NativeBridgeClient,
    'local:test',
    async (): Promise<NativeConnectionInfo> => ({ type: 'unknown' }),
  )
  const received: number[] = []
  const unsubscribe = proxy.subscribeTerminal('%1', (messageType, payload) => {
    received.push(messageType, ...payload)
  })
  await flushChannelOpen()

  proxy.openTerminalChannels()
  proxy.openTerminalChannels()
  await flushChannelOpen()
  expect(bridge.handlerCount()).toBe(1)

  bridge.emit(new Uint8Array([0, 65]))
  expect(received).toEqual([0, 65])

  bridge.generation++
  proxy.onBridgeDisconnected()
  expect(bridge.handlerCount()).toBe(0)
  proxy.openTerminalChannels()
  await flushChannelOpen()
  expect(bridge.handlerCount()).toBe(1)

  bridge.emit(new Uint8Array([0, 66]))
  expect(received).toEqual([0, 65, 0, 66])

  unsubscribe()
  expect(bridge.handlerCount()).toBe(0)
})

test('a stale terminal unsubscribe cannot close its replacement subscriber', async () => {
  const bridge = new FakeBridge()
  const proxy = new NativeTransportProxy(
    bridge as unknown as NativeBridgeClient,
    'local:test',
    async (): Promise<NativeConnectionInfo> => ({ type: 'unknown' }),
  )
  const firstReceived: number[] = []
  const replacementReceived: number[] = []

  const unsubscribeFirst = proxy.subscribeTerminal('%1', messageType => {
    firstReceived.push(messageType)
  })
  await flushChannelOpen()
  const unsubscribeReplacement = proxy.subscribeTerminal('%1', messageType => {
    replacementReceived.push(messageType)
  })
  await flushChannelOpen()

  unsubscribeFirst()
  bridge.emit(new Uint8Array([0, 66]))

  expect(firstReceived).toEqual([])
  expect(replacementReceived).toEqual([0])
  expect(bridge.handlerCount()).toBe(1)

  unsubscribeReplacement()
  expect(bridge.handlerCount()).toBe(0)
})

test('buffers channel data that arrives before the proxy subscribes', async () => {
  class FakeSocket implements BridgeSocket {
    readyState = 1
    binaryType = 'arraybuffer'
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
    send() {}
    close() {}
  }

  const socket = new FakeSocket()
  const bridge = new NativeBridgeClient(() => socket)
  bridge.connect()
  socket.onopen?.()

  const frame = (type: number, channelId: number, payload: Uint8Array) => {
    const bytes = new Uint8Array(7 + payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint8(0, type)
    view.setUint16(1, channelId)
    view.setUint32(3, payload.length)
    bytes.set(payload, 7)
    return bytes.buffer
  }

  socket.onmessage?.({ data: frame(0x01, 0x0200, new Uint8Array([1, 2, 3])) })
  const received: number[][] = []
  bridge.onChannelData(0x0200, payload => received.push(Array.from(payload)))

  expect(received).toEqual([[1, 2, 3]])
  bridge.destroy()
})
