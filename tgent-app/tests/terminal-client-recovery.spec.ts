import { expect, test } from '@playwright/test'
import { TerminalClient, type TerminalClientCallbacks } from '../../shared/src/api/terminalClient'
import {
  MSG_ERROR,
  MSG_PANE_STATE,
  MSG_PING,
  MSG_PONG,
  MSG_SNAPSHOT,
  PONG_FLAG_OUTPUT_WORKER,
} from '../../shared/src/api/protocol'
import type { WebRTCTransport } from '../../shared/src/api/transport'

class FakeTerminalChannel {
  readyState = 'open'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  onerror: (() => void) | null = null
  sent: Uint8Array[] = []

  send(data: ArrayBuffer | Uint8Array) {
    this.sent.push(new Uint8Array(data instanceof Uint8Array ? data : data.slice(0)))
  }
}

class FakeTerminalTransport {
  channels: FakeTerminalChannel[] = []
  closeCount = 0
  private subscriber: ((msgType: number, payload: Uint8Array) => void) | null = null

  getTerminalChannel(): FakeTerminalChannel {
    const channel = new FakeTerminalChannel()
    this.channels.push(channel)
    return channel
  }

  subscribeTerminal(_paneId: string, callback: (msgType: number, payload: Uint8Array) => void) {
    this.subscriber = callback
    return () => {
      if (this.subscriber === callback) this.subscriber = null
    }
  }

  closeTerminalChannel() {
    this.closeCount++
    this.subscriber = null
  }

  emit(msgType: number, payload = new Uint8Array()) {
    this.subscriber?.(msgType, payload)
  }
}

const paneState = () => new Uint8Array([0, 80, 0, 24])

function createClient(
  transport: FakeTerminalTransport,
  onClose: () => void,
  inputRecoveryTimeoutMs = 20,
) {
  const callbacks: TerminalClientCallbacks = {
    onOutput: () => {},
    onPaneState: () => {},
    onFrame: () => {},
    onError: () => {},
    onClose,
  }
  const client = new TerminalClient(callbacks, {
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 60_000,
    inputProbeDelayMs: 10,
    inputRecoveryTimeoutMs,
  })
  client.connect('%1', transport as unknown as WebRTCTransport)
  transport.emit(MSG_PANE_STATE, paneState())
  transport.channels[0].sent = []
  return client
}

test('input with a silent receive path probes it and rebuilds only the terminal channel', async () => {
  const transport = new FakeTerminalTransport()
  let closeCalls = 0
  const client = createClient(transport, () => { closeCalls++ })

  client.sendInput('echo alive\r')

  await expect.poll(() => transport.channels[0].sent.some(message => message[0] === MSG_PING)).toBe(true)
  await expect.poll(() => transport.channels.length).toBe(2)
  expect(transport.closeCount).toBeGreaterThan(0)
  expect(closeCalls).toBe(0)

  client.disconnect()
})

test('a pong response cancels input recovery without changing terminal content', async () => {
  const transport = new FakeTerminalTransport()
  const client = createClient(transport, () => {}, 200)

  client.sendInput('x')
  await expect.poll(() => transport.channels[0].sent.some(message => message[0] === MSG_PING)).toBe(true)
  transport.emit(MSG_PONG, new Uint8Array([PONG_FLAG_OUTPUT_WORKER]))
  await new Promise(resolve => setTimeout(resolve, 220))

  expect(transport.channels).toHaveLength(1)
  client.disconnect()
})

test('an old-agent pong falls back to one viewport probe', async () => {
  const transport = new FakeTerminalTransport()
  const client = createClient(transport, () => {}, 200)

  client.sendInput('x')
  await expect.poll(() => transport.channels[0].sent.some(message => message[0] === MSG_PING)).toBe(true)
  transport.emit(MSG_PONG)
  await expect.poll(() => transport.channels[0].sent.some(message => message[0] === MSG_SNAPSHOT)).toBe(true)
  transport.emit(MSG_PANE_STATE, paneState())
  await new Promise(resolve => setTimeout(resolve, 220))

  expect(transport.channels).toHaveLength(1)
  client.disconnect()
})

test('a server stream-stalled signal starts an in-place recovery immediately', async () => {
  const transport = new FakeTerminalTransport()
  const client = createClient(transport, () => {})

  transport.emit(MSG_ERROR, new TextEncoder().encode('terminal_stream_stalled'))

  await expect.poll(() => transport.channels.length).toBe(2)
  client.disconnect()
})
