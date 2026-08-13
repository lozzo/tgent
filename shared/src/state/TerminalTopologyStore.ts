import { ApiRequestError } from '../api/client'
import type { ProviderTopology, ServerApi, TerminalProtocolCapabilities } from '../api/types'

export type TopologyMode = 'detecting' | 'v2' | 'legacy' | 'error'

export interface TerminalTopologySnapshot {
  mode: TopologyMode
  topologies: ProviderTopology[]
  capabilities: TerminalProtocolCapabilities | null
  loading: boolean
  error: string | null
}

export class TerminalTopologyStore {
  private api: ServerApi | null = null
  private generation = 0
  private listeners = new Set<() => void>()
  private refreshPromise: Promise<void> | null = null
  private refreshAgain = false
  private hasSnapshotForGeneration = false
  private snapshotValue: TerminalTopologySnapshot = {
    mode: 'detecting',
    topologies: [],
    capabilities: null,
    loading: false,
    error: null,
  }

  get snapshot(): TerminalTopologySnapshot { return this.snapshotValue }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  bind(api: ServerApi): void {
    this.api = api
    const generation = ++this.generation
    this.refreshPromise = null
    this.refreshAgain = false
    this.hasSnapshotForGeneration = false
    this.update({ mode: 'detecting', loading: true, error: null })
    const negotiation = this.negotiate(api, generation).finally(() => {
      if (this.refreshPromise === negotiation) this.refreshPromise = null
    })
    this.refreshPromise = negotiation
  }

  unbind(): void {
    this.api = null
    this.generation++
    this.refreshPromise = null
    this.refreshAgain = false
    this.hasSnapshotForGeneration = false
    this.update({ loading: false })
  }

  destroy(): void {
    this.unbind()
    this.snapshotValue = {
      mode: 'detecting',
      topologies: [],
      capabilities: null,
      loading: false,
      error: null,
    }
    this.listeners.clear()
  }

  refresh(): Promise<void> {
    const api = this.api
    if (!api?.topology || this.snapshotValue.mode === 'legacy') return Promise.resolve()
    if (this.refreshPromise) {
      this.refreshAgain = true
      return this.refreshPromise
    }

    const generation = this.generation
    if (this.snapshotValue.mode !== 'v2') {
      this.update({ mode: 'detecting', loading: true, error: null })
      const negotiation = this.negotiate(api, generation).finally(() => {
        if (this.refreshPromise === negotiation) this.refreshPromise = null
      })
      this.refreshPromise = negotiation
      return negotiation
    }

    return this.refreshTopology(api, generation)
  }

  private refreshTopology(api: ServerApi, generation: number): Promise<void> {
    const run = async () => {
      do {
        this.refreshAgain = false
        const incoming = await api.topology!.getTopology()
        if (this.api !== api || this.generation !== generation) return
        const previous = new Map(this.snapshotValue.topologies.map(item => [item.provider.id, item]))
        const topologies = incoming.map(item => {
          const current = previous.get(item.provider.id)
          return this.hasSnapshotForGeneration && current && current.revision > item.revision ? current : item
        })
        this.hasSnapshotForGeneration = true
        this.update({ topologies, loading: false, error: null })
      } while (this.refreshAgain && this.api === api && this.generation === generation)
    }

    const promise = run().catch(error => {
      if (this.api === api && this.generation === generation) {
        this.update({ loading: false, error: errorMessage(error) })
      }
    }).finally(() => {
      if (this.refreshPromise === promise) this.refreshPromise = null
    })
    this.refreshPromise = promise
    return promise
  }

  private async negotiate(api: ServerApi, generation: number): Promise<void> {
    if (!api.topology) {
      this.setLegacy(api, generation)
      return
    }
    try {
      const capabilities = await api.topology.capabilities()
      if (this.api !== api || this.generation !== generation) return
      if (!capabilities.api_versions.includes(2)) {
        this.setLegacy(api, generation, capabilities)
        return
      }
      this.update({ mode: 'v2', capabilities, loading: true, error: null })
      await this.refreshTopology(api, generation)
    } catch (error) {
      if (this.api !== api || this.generation !== generation) return
      if (isUnsupported(error)) {
        this.setLegacy(api, generation)
        return
      }
      this.update({ mode: 'error', loading: false, error: errorMessage(error) })
    }
  }

  private setLegacy(api: ServerApi, generation: number, capabilities: TerminalProtocolCapabilities | null = null): void {
    if (this.api !== api || this.generation !== generation) return
    this.update({
      mode: 'legacy',
      topologies: [],
      capabilities,
      loading: false,
      error: null,
    })
  }

  private update(patch: Partial<TerminalTopologySnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch }
    this.listeners.forEach(listener => listener())
  }
}

function isUnsupported(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 404 || error.status === 501)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
