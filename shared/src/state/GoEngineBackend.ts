import { NativeConnection, type NativeConnectionInfo, type NativeSnapshot } from '../plugins/nativeConnection'
import {
  getWebRefreshToken,
  getWebToken,
  getWebUrl,
  setWebRefreshToken,
  setWebToken,
} from '../lib/platform'
import { NativeBridgeClient, type BridgeSocket } from './NativeBridgeClient'

type ListenerHandle = { remove: () => void | Promise<void> }
type StateListener = (snapshot: NativeSnapshot) => void

export interface GoEngineBackend {
  getBridgeClient(): Promise<NativeBridgeClient>
  addStateListener(listener: StateListener): Promise<ListenerHandle>
  connect(serverType: string, serverId: string, localServer?: string): Promise<void>
  retry(serverType: string, serverId: string): Promise<void>
  release(serverType: string, serverId: string): Promise<void>
  releaseAll(): Promise<void>
  releaseHubStores(): Promise<void>
  releaseStores(keys: string[]): Promise<void>
  getSnapshot(serverType: string, serverId: string): Promise<NativeSnapshot>
  getConnectionInfo(storeKey: string): Promise<NativeConnectionInfo>
  network(up: boolean): Promise<void>
  lifecycle(active: boolean, resume: boolean): Promise<void>
  destroy(): void
}

export class NativeGoEngineBackend implements GoEngineBackend {
  private bridge: NativeBridgeClient | null = null

  async getBridgeClient(): Promise<NativeBridgeClient> {
    if (!this.bridge) {
      const { port } = await NativeConnection.getBridgePort()
      if (port <= 0) throw new Error('Go bridge is unavailable')
      this.bridge = new NativeBridgeClient(port)
    }
    return this.bridge
  }

  async addStateListener(listener: StateListener): Promise<ListenerHandle> {
    return NativeConnection.addListener('stateChange', listener)
  }

  connect(serverType: string, serverId: string, localServer?: string) {
    return NativeConnection.connect({ serverType, serverId, localServer })
  }
  retry(serverType: string, serverId: string) { return NativeConnection.retry({ serverType, serverId }) }
  release(serverType: string, serverId: string) { return NativeConnection.release({ serverType, serverId }) }
  releaseAll() { return NativeConnection.releaseAll() }
  releaseHubStores() { return NativeConnection.releaseHubStores() }
  releaseStores(keys: string[]) { return NativeConnection.releaseStores({ keys }) }
  getSnapshot(serverType: string, serverId: string) { return NativeConnection.getSnapshot({ serverType, serverId }) }
  getConnectionInfo(storeKey: string) { return NativeConnection.getConnectionInfo({ storeKey }) }
  // Android sends ConnectivityManager events directly to Go, outside the WebView lifecycle.
  network(_up: boolean) { return Promise.resolve() }
  lifecycle(_active: boolean, _resume: boolean) { return Promise.resolve() }
  destroy() { this.bridge?.destroy(); this.bridge = null }
}

interface WasmResult<T> { ok: boolean; data: T; error?: string }
interface TgentGoAPI {
  abiVersion(): number
  create(): WasmResult<number>
  command(handle: number, command: string): WasmResult<string>
  nextEvent(handle: number): WasmResult<string>
  bridgeFrame(handle: number, frame: Uint8Array): WasmResult<null>
  nextBridgeFrame(handle: number): WasmResult<Uint8Array | null>
  close(handle: number): WasmResult<null>
}

interface WailsDesktopAPI {
  BridgePort(): Promise<number>
  Command(payload: string): Promise<string>
  DiscoverLocalTGent(): Promise<{
    found: boolean
    address?: string
    name?: string
    socketPath?: string
    requiresPassword?: boolean
    agentId?: string
    hubAddr?: string
  }>
  GetLocalTGentAccess(): Promise<{
    found: boolean
    address?: string
    name?: string
    socketAvailable: boolean
    socketPath?: string
    authEnabled: boolean
    passwordAvailable: boolean
    agentId?: string
    hubAddr?: string
  }>
  GetLocalTGentPassword(): Promise<string>
  NextEvent(): Promise<string>
  ValidateLocalTGent(address: string, password: string): Promise<{
    ok: boolean
    requiresPassword?: boolean
    error?: string
  }>
}

declare global {
  interface Window {
    Go?: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> }
    TgentGo?: TgentGoAPI
    go?: {
      main?: {
        App?: WailsDesktopAPI
      }
    }
  }
}

let wasmAPIPromise: Promise<TgentGoAPI> | null = null

async function loadWasmAPI(): Promise<TgentGoAPI> {
  if (window.TgentGo) return window.TgentGo
  if (wasmAPIPromise) return wasmAPIPromise
  wasmAPIPromise = (async () => {
    const base = import.meta.env.BASE_URL || '/'
    if (!window.Go) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script')
        script.src = `${base}wasm/wasm_exec.js`
        script.onload = () => resolve()
        script.onerror = () => reject(new Error('failed to load Go WASM runtime'))
        document.head.appendChild(script)
      })
    }
    if (!window.Go) throw new Error('Go WASM runtime did not initialize')
    const go = new window.Go()
    const url = `${base}wasm/tgent-client.wasm`
    let instance: WebAssembly.Instance
    try {
      const result = await WebAssembly.instantiateStreaming(fetch(url), go.importObject)
      instance = result.instance
    } catch {
      const bytes = await (await fetch(url)).arrayBuffer()
      instance = (await WebAssembly.instantiate(bytes, go.importObject)).instance
    }
    void go.run(instance)
    for (let i = 0; i < 200 && !window.TgentGo; i++) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    if (!window.TgentGo || window.TgentGo.abiVersion() !== 1) {
      throw new Error('unsupported Tgent Go WASM ABI')
    }
    return window.TgentGo
  })()
  return wasmAPIPromise
}

function unwrap<T>(result: WasmResult<T>): T {
  if (!result?.ok) throw new Error(result?.error || 'Go engine call failed')
  return result.data
}

export class WailsGoEngineBackend implements GoEngineBackend {
  private api: WailsDesktopAPI | null = null
  private bridge: NativeBridgeClient | null = null
  private listeners = new Set<StateListener>()
  private eventTimer: ReturnType<typeof setTimeout> | null = null
  private initPromise: Promise<void> | null = null
  private generation = 0

  private async init(): Promise<void> {
    if (this.api && this.bridge) return
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const api = window.go?.main?.App
        if (!api) throw new Error('Wails desktop bridge is unavailable')
        const port = await api.BridgePort()
        if (port <= 0) throw new Error('Go bridge is unavailable')
        this.api = api
        this.bridge = new NativeBridgeClient(port)
        const generation = ++this.generation
        this.pollEvents(generation)
      })()
    }
    try {
      await this.initPromise
    } catch (error) {
      this.initPromise = null
      throw error
    }
  }

  async getBridgeClient(): Promise<NativeBridgeClient> {
    await this.init()
    return this.bridge!
  }

  async addStateListener(listener: StateListener): Promise<ListenerHandle> {
    await this.init()
    this.listeners.add(listener)
    return { remove: () => { this.listeners.delete(listener) } }
  }

  async connect(serverType: string, serverId: string, localServer?: string): Promise<void> {
    const [webUrl, webToken, refreshToken] = await Promise.all([
      getWebUrl(), getWebToken(), getWebRefreshToken(),
    ])
    await this.command({
      action: 'connect', serverType, serverId,
      localServer: localServer ? JSON.parse(localServer) : undefined,
      webUrl, webToken: webToken || '', refreshToken: refreshToken || '',
    })
  }

  async retry(serverType: string, serverId: string) { await this.command({ action: 'retry', serverType, serverId }) }
  async release(serverType: string, serverId: string) { await this.command({ action: 'release', serverType, serverId }) }
  async releaseAll() { await this.command({ action: 'release_all' }) }
  async releaseHubStores() { await this.command({ action: 'release_hub' }) }
  async releaseStores(keys: string[]) { await this.command({ action: 'release_keys', keys }) }

  async getSnapshot(serverType: string, serverId: string): Promise<NativeSnapshot> {
    return await this.command({ action: 'snapshot', serverType, serverId }) as NativeSnapshot
  }

  async getConnectionInfo(storeKey: string): Promise<NativeConnectionInfo> {
    return await this.command({ action: 'connection_info', storeKey }) as NativeConnectionInfo
  }

  async network(up: boolean): Promise<void> { await this.command({ action: 'network', networkUp: up }) }
  async lifecycle(active: boolean, resume: boolean): Promise<void> {
    await this.command({ action: 'lifecycle', appActive: active, resume })
  }

  destroy(): void {
    this.generation++
    if (this.eventTimer) clearTimeout(this.eventTimer)
    this.eventTimer = null
    this.bridge?.destroy()
    this.bridge = null
    this.api = null
    this.initPromise = null
    this.listeners.clear()
  }

  private async command(payload: Record<string, unknown>): Promise<unknown> {
    await this.init()
    const raw = await this.api!.Command(JSON.stringify(payload))
    return raw ? JSON.parse(raw) : null
  }

  private pollEvents = async (generation: number) => {
    if (!this.api || generation !== this.generation) return
    try {
      const raw = await this.api.NextEvent()
      if (generation !== this.generation) return
      if (raw) {
        const event = JSON.parse(raw)
        if (event.type === 'state_change' && event.snapshot) {
          const snapshot = { ...event.snapshot, storeKey: event.storeKey } as NativeSnapshot
          for (const listener of this.listeners) listener(snapshot)
        } else if (event.type === 'token_update') {
          if (event.token) void setWebToken(event.token)
          if (event.refreshToken) void setWebRefreshToken(event.refreshToken)
        }
      }
    } catch (error) {
      if (generation === this.generation) {
        console.warn('[WailsGoEngineBackend] event polling failed', error)
      }
    }
    if (generation === this.generation) {
      this.eventTimer = setTimeout(() => this.pollEvents(generation), document.hidden ? 250 : 0)
    }
  }
}

class WasmBridgeSocket implements BridgeSocket {
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private api: TgentGoAPI, private handle: number) {
    queueMicrotask(() => {
      if (this.readyState !== 0) return
      this.readyState = 1
      this.onopen?.()
      this.poll()
    })
  }

  send(data: ArrayBuffer): void {
    if (this.readyState !== 1) return
    try {
      unwrap(this.api.bridgeFrame(this.handle, new Uint8Array(data)))
      this.drain()
    } catch (error) {
      this.onerror?.(error)
    }
  }

  close(): void {
    if (this.readyState >= 2) return
    this.readyState = 3
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.onclose?.()
  }

  private poll = () => {
    if (this.readyState !== 1) return
    this.drain()
    this.timer = setTimeout(this.poll, document.hidden ? 100 : 8)
  }

  private drain(): void {
    for (let i = 0; i < 128; i++) {
      const frame = unwrap(this.api.nextBridgeFrame(this.handle))
      if (!frame) break
      const copy = new Uint8Array(frame.byteLength)
      copy.set(frame)
      this.onmessage?.({ data: copy.buffer })
    }
  }
}

export class WasmGoEngineBackend implements GoEngineBackend {
  private api: TgentGoAPI | null = null
  private handle = 0
  private bridge: NativeBridgeClient | null = null
  private listeners = new Set<StateListener>()
  private eventTimer: ReturnType<typeof setTimeout> | null = null
  private initPromise: Promise<void> | null = null

  private async init(): Promise<void> {
    if (this.handle) return
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.api = await loadWasmAPI()
        this.handle = unwrap(this.api.create())
        this.bridge = new NativeBridgeClient(() => new WasmBridgeSocket(this.api!, this.handle))
        this.pollEvents()
      })()
    }
    await this.initPromise
  }

  async getBridgeClient(): Promise<NativeBridgeClient> {
    await this.init()
    return this.bridge!
  }

  async addStateListener(listener: StateListener): Promise<ListenerHandle> {
    await this.init()
    this.listeners.add(listener)
    return { remove: () => { this.listeners.delete(listener) } }
  }

  async connect(serverType: string, serverId: string, localServer?: string): Promise<void> {
    const [webUrl, webToken, refreshToken] = await Promise.all([
      getWebUrl(), getWebToken(), getWebRefreshToken(),
    ])
    await this.command({
      action: 'connect', serverType, serverId,
      localServer: localServer ? JSON.parse(localServer) : undefined,
      webUrl, webToken: webToken || '', refreshToken: refreshToken || '',
    })
  }

  async retry(serverType: string, serverId: string) { await this.command({ action: 'retry', serverType, serverId }) }
  async release(serverType: string, serverId: string) { await this.command({ action: 'release', serverType, serverId }) }
  async releaseAll() { await this.command({ action: 'release_all' }) }
  async releaseHubStores() { await this.command({ action: 'release_hub' }) }
  async releaseStores(keys: string[]) { await this.command({ action: 'release_keys', keys }) }

  async getSnapshot(serverType: string, serverId: string): Promise<NativeSnapshot> {
    return await this.command({ action: 'snapshot', serverType, serverId }) as NativeSnapshot
  }

  async getConnectionInfo(storeKey: string): Promise<NativeConnectionInfo> {
    return await this.command({ action: 'connection_info', storeKey }) as NativeConnectionInfo
  }

  async network(up: boolean): Promise<void> { await this.command({ action: 'network', networkUp: up }) }
  async lifecycle(active: boolean, resume: boolean): Promise<void> {
    await this.command({ action: 'lifecycle', appActive: active, resume })
  }

  destroy(): void {
    if (this.eventTimer) clearTimeout(this.eventTimer)
    this.eventTimer = null
    this.bridge?.destroy()
    if (this.api && this.handle) unwrap(this.api.close(this.handle))
    this.handle = 0
    this.bridge = null
    this.listeners.clear()
  }

  private async command(payload: Record<string, unknown>): Promise<unknown> {
    await this.init()
    const raw = unwrap(this.api!.command(this.handle, JSON.stringify(payload)))
    return raw ? JSON.parse(raw) : null
  }

  private pollEvents = () => {
    if (!this.api || !this.handle) return
    for (let i = 0; i < 64; i++) {
      const raw = unwrap(this.api.nextEvent(this.handle))
      if (!raw) break
      const event = JSON.parse(raw)
      if (event.type === 'state_change' && event.snapshot) {
        const snapshot = { ...event.snapshot, storeKey: event.storeKey } as NativeSnapshot
        for (const listener of this.listeners) listener(snapshot)
      } else if (event.type === 'token_update') {
        if (event.token) void setWebToken(event.token)
        if (event.refreshToken) void setWebRefreshToken(event.refreshToken)
      }
    }
    this.eventTimer = setTimeout(this.pollEvents, document.hidden ? 250 : 16)
  }
}
