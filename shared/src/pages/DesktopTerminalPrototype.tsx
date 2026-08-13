import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  Activity,
  AppWindow,
  Check,
  ChevronRight,
  ClipboardPaste,
  Columns2,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderPlus,
  FolderOpen,
  GripVertical,
  Layers3,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Network,
  Pause,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Rows2,
  Search,
  Scissors,
  Server,
  Settings2,
  SquareTerminal,
  TriangleAlert,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import Terminal, { type TerminalHandle, type TerminalResizeState } from '../components/Terminal'
import DesktopSettingsDialog from '../components/settings/DesktopSettingsDialog'
import { useAppContext } from '../contexts/AppContext'
import { useConnectionStore } from '../hooks/useConnectionStore'
import { useFileManager, type TransferProps } from '../hooks/useFileManager'
import { useFileTransferStore } from '../hooks/useFileTransferStore'
import type { WebRTCTransport } from '../api/transport'
import type { ServerApi } from '../api/client'
import type { FileEntry } from '../types/files'
import {
  desktopAppearanceStyle,
  formatDesktopShortcut,
  getDefaultDesktopSettings,
  loadDesktopSettings,
  matchesDesktopShortcut,
  type DesktopSettings,
} from '../lib/desktopSettings'
import { getDefaultTerminalSettings, loadTerminalSettings, saveTerminalSettings } from '../lib/terminalSettings'
import { desktopTabTitle, normalizeTerminalTitle } from '../lib/desktopTabTitle'
import {
  DESKTOP_WARM_TAB_TTL_MS,
  equalTerminalTabOrder,
  nextWarmTerminalTabs,
} from '../lib/terminalResidency'
import { translateError } from '../lib/errors'
import { rememberDesktopTerminal } from '../lib/desktopTerminalHistory'
import { connectionColorForKey, findLocalServerById, getConnectionColor, getLocalServers, LOCAL_SERVERS_CHANGE_EVENT, type LocalServer } from '../lib/localServers'
import { getTheme, loadThemeId, type ThemeDefinition } from '../lib/themes'
import type { WailsClipboardImage } from '../lib/platform'
import type { ConnectionSnapshot } from '../state/connectionTypes'
import type { NativeConnectionStoreProxy } from '../state/NativeConnectionStoreProxy'
import {
  DESKTOP_BACKGROUND_EVENT,
  loadDesktopBackgroundImage,
  type DesktopBackgroundImage,
} from '../lib/desktopBackground'
import '@xterm/xterm/css/xterm.css'
import './desktop-terminal-prototype.css'

type SplitDirection = 'vertical' | 'horizontal'
type ConnectionStatus = 'connected' | 'offline'
type PaneDropIntent = 'replace' | 'left' | 'right' | 'top' | 'bottom'
type TopologyAction = 'open' | 'split-right' | 'split-below' | 'create' | 'rename' | 'refresh' | 'delete' | 'edit-connection'

function clipboardImageFile(image: WailsClipboardImage): File {
  if (!image.data) throw new Error('剪贴板图片数据不可用')
  const decoded = atob(image.data)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index)
  const sourceName = (image.name || 'clipboard.png').replace(/[^a-zA-Z0-9._-]/g, '-')
  const name = `tgent-${Date.now()}-${sourceName}`
  return new File([bytes], name, { type: 'image/png', lastModified: Date.now() })
}

interface RemoteEndpoint {
  id: string
  label: string
  host: string
  connectionKey: string
  tmuxInstanceId: string
  transport: 'P2P' | 'RELAY'
  latency: number
  initialStatus: ConnectionStatus
  color: string
  failFirstAttempt?: boolean
}

function localServerHost(server: LocalServer): string {
  for (const candidate of [server.addr, ...(server.localAddrs || []), server.hubAddr]) {
    if (!candidate) continue
    try { return new URL(candidate).hostname }
    catch {}
  }
  return server.socketPath ? 'localhost' : server.hubAgentId || 'TGent'
}

function endpointForLocalServer(server: LocalServer, snapshot?: ConnectionSnapshot): RemoteEndpoint {
  return {
    id: server.id,
    label: server.name || 'TGent',
    host: localServerHost(server),
    connectionKey: `local:${server.id}`,
    tmuxInstanceId: `tmux:${server.id}`,
    transport: 'P2P',
    latency: 0,
    initialStatus: snapshot?.isConnected ? 'connected' : 'offline',
    color: getConnectionColor(server),
  }
}

function waitForConnectedStore(store: NativeConnectionStoreProxy, timeoutMs = 5_000): Promise<ConnectionSnapshot | null> {
  const current = store.getSnapshot()
  if (current.isConnected && current.transport) return Promise.resolve(current)

  return new Promise(resolve => {
    let settled = false
    let unsubscribe = () => {}
    const finish = (snapshot: ConnectionSnapshot | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      unsubscribe()
      resolve(snapshot)
    }
    const publish = () => {
      const snapshot = store.getSnapshot()
      if (snapshot.isConnected && snapshot.transport) finish(snapshot)
      else if (snapshot.isFailed || snapshot.needLogin || snapshot.needSubscription) finish(null)
    }
    unsubscribe = store.subscribe(publish)
    const timeout = window.setTimeout(() => finish(null), timeoutMs)
    publish()
  })
}

interface DesktopRuntimeBridge {
  EventsOn?: (eventName: string, callback: (...data: unknown[]) => void) => () => void
  WindowHide?: () => void
}

interface PaneLeaf {
  type: 'pane'
  id: string
  endpointId: string
  endpointLabel: string
  connectionColor: string
  connectionKey: string
  tmuxInstanceId: string
  terminalTitle: string
  host: string
  path: string
  session: string
  sessionId?: string
  windowName: string
  remotePaneId: string
  transport: 'P2P' | 'RELAY'
  latency: number
  detached: boolean
  unbound?: boolean
}

interface TerminalProfile {
  profileId: string
  endpointId: string
  tmuxInstanceId?: string
  terminalTitle: string
  path: string
  session: string
  sessionId?: string
  windowName: string
  windowId?: string
  remotePaneId: string
}

type TerminalPickerMatchField = 'terminalTitle' | 'endpointLabel' | 'endpointHost' | 'session' | 'windowName' | 'remotePaneId'
type TerminalPickerMatchMap = Partial<Record<TerminalPickerMatchField, number[]>>

interface TerminalPickerSearchResult {
  profile: TerminalProfile
  matches: TerminalPickerMatchMap
  score: number
}

function fuzzyTextMatch(query: string, value: string): { indices: number[]; score: number } | null {
  const needle = Array.from(query.toLocaleLowerCase())
  const haystack = Array.from(value.toLocaleLowerCase())
  if (!needle.length) return { indices: [], score: 0 }

  let exactStart = -1
  for (let index = 0; index <= haystack.length - needle.length; index++) {
    if (needle.every((character, offset) => haystack[index + offset] === character)) {
      exactStart = index
      break
    }
  }
  if (exactStart >= 0) {
    const indices = needle.map((_, index) => exactStart + index)
    const prefixBonus = exactStart === 0 ? 180 : 0
    const boundaryBonus = exactStart === 0 || /[\s._:/-]/.test(haystack[exactStart - 1] || '') ? 80 : 0
    return { indices, score: 700 + prefixBonus + boundaryBonus - exactStart - Math.max(0, haystack.length - needle.length) }
  }

  const indices: number[] = []
  let cursor = 0
  for (const character of needle) {
    const index = haystack.indexOf(character, cursor)
    if (index < 0) return null
    indices.push(index)
    cursor = index + 1
  }

  let consecutive = 0
  let boundaries = 0
  indices.forEach((index, position) => {
    if (position > 0 && index === indices[position - 1] + 1) consecutive++
    if (index === 0 || /[\s._:/-]/.test(haystack[index - 1] || '')) boundaries++
  })
  const spread = indices[indices.length - 1] - indices[0] + 1
  return {
    indices,
    score: 320 + consecutive * 28 + boundaries * 38 - (spread - needle.length) * 5 - indices[0],
  }
}

function rankTerminalProfiles(
  profiles: TerminalProfile[],
  endpointForProfile: (profile: TerminalProfile) => RemoteEndpoint | undefined,
  query: string,
): TerminalPickerSearchResult[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return profiles.map(profile => ({ profile, matches: {}, score: 0 }))

  const fieldWeights: Record<TerminalPickerMatchField, number> = {
    terminalTitle: 120,
    endpointLabel: 90,
    endpointHost: 85,
    session: 70,
    windowName: 60,
    remotePaneId: 30,
  }

  return profiles.flatMap<TerminalPickerSearchResult>((profile, order) => {
    const endpoint = endpointForProfile(profile)
    const fields: Record<TerminalPickerMatchField, string> = {
      terminalTitle: profile.terminalTitle,
      endpointLabel: endpoint?.label || '',
      endpointHost: endpoint?.host || '',
      session: profile.session,
      windowName: profile.windowName,
      remotePaneId: profile.remotePaneId,
    }
    const matches: TerminalPickerMatchMap = {}
    let score = 0

    for (const token of tokens) {
      let best: { field: TerminalPickerMatchField; indices: number[]; score: number } | null = null
      for (const [field, value] of Object.entries(fields) as Array<[TerminalPickerMatchField, string]>) {
        const match = fuzzyTextMatch(token, value)
        if (!match) continue
        const weightedScore = match.score + fieldWeights[field]
        if (!best || weightedScore > best.score) best = { field, indices: match.indices, score: weightedScore }
      }
      if (!best) return []
      matches[best.field] = [...new Set([...(matches[best.field] || []), ...best.indices])].sort((a, b) => a - b)
      score += best.score
    }

    return [{ profile, matches, score: score - order / 1000 }]
  }).sort((a, b) => b.score - a.score)
}

function HighlightedPickerText({ text, indices }: { text: string; indices?: number[] }) {
  if (!indices?.length) return <>{text}</>
  const highlighted = new Set(indices)
  const characters = Array.from(text)
  const segments: Array<{ text: string; highlighted: boolean }> = []
  characters.forEach((character, index) => {
    const isHighlighted = highlighted.has(index)
    const previous = segments[segments.length - 1]
    if (previous?.highlighted === isHighlighted) previous.text += character
    else segments.push({ text: character, highlighted: isHighlighted })
  })
  return <>{segments.map((segment, index) => segment.highlighted
    ? <mark key={index} className="desktop-terminal-picker-match">{segment.text}</mark>
    : <span key={index}>{segment.text}</span>)}</>
}

const DESKTOP_MANAGED_TMUX_SESSION = 'tgent'

function nextManagedTerminalNumber(profiles: TerminalProfile[]) {
  return profiles
    .filter(profile => profile.session === DESKTOP_MANAGED_TMUX_SESSION)
    .reduce((highest, profile) => {
      const match = /^terminal-(\d+)$/.exec(profile.windowName)
      return Math.max(highest, match ? Number(match[1]) : 0)
    }, 0) + 1
}

interface SplitNode {
  type: 'split'
  id: string
  direction: SplitDirection
  ratio: number
  first: LayoutNode
  second: LayoutNode
}

type LayoutNode = PaneLeaf | SplitNode

interface PrototypeTab {
  id: string
  title: string
  root: LayoutNode
  activePaneId: string
  maximizedPaneId: string | null
}

interface ContextMenuState {
  paneId: string
  x: number
  y: number
}

interface PickerConnectionError {
  profileId: string
  message: string
}

interface BroadcastCandidate {
  key: string
  pane: PaneLeaf
}

type TopologyBrowserKind = 'endpoint' | 'session' | 'window' | 'pane'

interface TopologyBrowserNode {
  key: string
  kind: TopologyBrowserKind
  label: string
  meta: string
  endpointId: string
  session?: string
  windowName?: string
  resourceId?: string
  profile?: TerminalProfile
  children?: TopologyBrowserNode[]
}

interface TopologyDragData {
  type: 'topology-pane'
  profile: TerminalProfile
}

interface PaneDropData {
  type: 'pane-drop'
  paneId: string
  intent: PaneDropIntent
}

interface PaneDropPreview {
  paneId: string
  intent: PaneDropIntent
  pixelWidth: number
  pixelHeight: number
  columns: number
  rows: number
}

interface TopologyMutationState {
  mode: 'create' | 'rename' | 'delete'
  node: TopologyBrowserNode
  value: string
}

interface MockTerminalHandle {
  focus: () => void
  fit: () => void
  syncViewport: () => void
  prepareLayoutChange: (settleMs?: number) => void
  takeResizeControl: () => void
  receiveInput: (data: string) => void
  reconnect: () => void
  setFontSize: (size: number) => void
  searchNext: (query: string) => boolean
  searchPrevious: (query: string) => boolean
  clearSearch: () => void
  clearScrollback: () => void
}

function preparePaneRemovalLayout(
  tabs: PrototypeTab[],
  terminals: Map<string, MockTerminalHandle>,
  paneId: string,
) {
  const tab = tabs.find(candidate => !!findPane(candidate.root, paneId))
  if (!tab) return
  const survivors = listPanes(tab.root).filter(pane => pane.id !== paneId && !pane.detached && !pane.unbound)
  if (!survivors.length) return
  survivors.forEach(pane => terminals.get(pane.id)?.prepareLayoutChange(180))
}

type TerminalActivityAlert = 'error' | 'exited' | null
type TerminalActivityState = 'working' | 'quiet' | 'attention'

interface TerminalActivityRecord {
  lastOutputAt: number
  alert: TerminalActivityAlert
}

interface TerminalActivitySnapshot {
  state: TerminalActivityState
  secondsSinceOutput: number
  reason: string
}

interface MonitoredTerminal {
  key: string
  tabId: string
  tabTitle: string
  pane: PaneLeaf
  activity: TerminalActivityRecord
}

let paneSequence = 0
let splitSequence = 0
let tabSequence = 0

const TERMINAL_WORKING_WINDOW_MS = 5_000
const TERMINAL_ATTENTION_WINDOW_MS = 20_000
const DESKTOP_FOLLOWED_TERMINALS_STORAGE_KEY = 'tgent.desktop.followed-terminals.v1'

function loadFollowedTerminalKeys(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const stored = window.localStorage.getItem(DESKTOP_FOLLOWED_TERMINALS_STORAGE_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

function saveFollowedTerminalKeys(keys: Set<string>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DESKTOP_FOLLOWED_TERMINALS_STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Following terminals is optional; unavailable storage should not block the terminal UI.
  }
}

const remoteEndpoints: RemoteEndpoint[] = [
  { id: 'agent-sg-prod', label: 'Singapore production', host: 'prod-sg-01', connectionKey: 'hub:agent-sg-prod', tmuxInstanceId: 'default-tmux', transport: 'P2P', latency: 32, initialStatus: 'connected', color: '#4f7dff' },
  { id: 'agent-tokyo-edge', label: 'Tokyo edge', host: 'edge-tokyo', connectionKey: 'hub:agent-tokyo-edge', tmuxInstanceId: 'default-tmux', transport: 'RELAY', latency: 91, initialStatus: 'connected', color: '#24a875' },
  { id: 'agent-hk-build', label: 'Hong Kong build', host: 'build-hk-02', connectionKey: 'local:agent-hk-build', tmuxInstanceId: 'default-tmux', transport: 'P2P', latency: 48, initialStatus: 'connected', color: '#d28b2c' },
  { id: 'agent-fra-edge', label: 'Frankfurt edge', host: 'edge-fra-01', connectionKey: 'hub:agent-fra-edge', tmuxInstanceId: 'default-tmux', transport: 'RELAY', latency: 138, initialStatus: 'offline', failFirstAttempt: true, color: '#d85a67' },
]

const initialTerminalProfiles: TerminalProfile[] = [
  { profileId: 'prod-api-watch', endpointId: 'agent-sg-prod', terminalTitle: 'api watch', path: '~/deploy/api', session: 'deploy', windowName: 'api', remotePaneId: '%8' },
  { profileId: 'prod-worker-logs', endpointId: 'agent-sg-prod', terminalTitle: 'worker logs', path: '~/deploy/worker', session: 'deploy', windowName: 'worker', remotePaneId: '%11' },
  { profileId: 'tokyo-inference', endpointId: 'agent-tokyo-edge', terminalTitle: 'inference shell', path: '~/inference', session: 'inference', windowName: 'serve', remotePaneId: '%3' },
  { profileId: 'hk-test-runner', endpointId: 'agent-hk-build', terminalTitle: 'test runner', path: '~/tgent', session: 'build', windowName: 'tests', remotePaneId: '%4' },
  { profileId: 'hk-release', endpointId: 'agent-hk-build', terminalTitle: 'release builder', path: '~/release', session: 'build', windowName: 'release', remotePaneId: '%7' },
  { profileId: 'fra-gateway', endpointId: 'agent-fra-edge', terminalTitle: 'gateway logs', path: '~/gateway', session: 'edge', windowName: 'gateway', remotePaneId: '%8' },
  { profileId: 'fra-metrics', endpointId: 'agent-fra-edge', terminalTitle: 'metrics console', path: '~/observability', session: 'edge', windowName: 'metrics', remotePaneId: '%12' },
]

function buildTopologyBrowserNodes(profiles: TerminalProfile[], endpoints: RemoteEndpoint[] = remoteEndpoints): TopologyBrowserNode[] {
  return endpoints.map(endpoint => {
    const sessionGroups = new Map<string, Map<string, TerminalProfile[]>>()
    profiles.filter(profile => profile.endpointId === endpoint.id).forEach(profile => {
      let windows = sessionGroups.get(profile.session)
      if (!windows) {
        windows = new Map()
        sessionGroups.set(profile.session, windows)
      }
      const profiles = windows.get(profile.windowName) ?? []
      profiles.push(profile)
      windows.set(profile.windowName, profiles)
    })

    const sessions = [...sessionGroups.entries()].map<TopologyBrowserNode>(([session, windows]) => ({
      key: `endpoint:${endpoint.id}:session:${session}`,
      kind: 'session',
      label: session,
      meta: `${windows.size} ${windows.size === 1 ? 'window' : 'windows'}`,
      endpointId: endpoint.id,
      session,
      children: [...windows.entries()].map<TopologyBrowserNode>(([windowName, profiles]) => ({
        key: `endpoint:${endpoint.id}:session:${session}:window:${windowName}`,
        kind: 'window',
        label: windowName,
        meta: `${profiles.length} ${profiles.length === 1 ? 'pane' : 'panes'}`,
        endpointId: endpoint.id,
        session,
        windowName,
        children: profiles.map(profile => ({
          key: `terminal:${terminalProfileKey(profile)}`,
          kind: 'pane',
          label: profile.terminalTitle,
          meta: profile.remotePaneId,
          endpointId: endpoint.id,
          profile,
        })),
      })),
    }))

    const paneCount = profiles.filter(profile => profile.endpointId === endpoint.id).length
    return {
      key: `endpoint:${endpoint.id}`,
      kind: 'endpoint',
      label: endpoint.label,
      meta: `${endpoint.host} · ${paneCount} ${paneCount === 1 ? 'pane' : 'panes'}`,
      endpointId: endpoint.id,
      children: sessions,
    }
  })
}

function topologyBranchKeys(nodes: TopologyBrowserNode[]): Set<string> {
  const keys = new Set<string>()
  const visit = (node: TopologyBrowserNode) => {
    if (!node.children?.length) return
    keys.add(node.key)
    node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return keys
}

function topologyNodeContainsTerminal(node: TopologyBrowserNode, terminalKey: string): boolean {
  if (node.profile) return terminalProfileKey(node.profile) === terminalKey
  return node.children?.some(child => topologyNodeContainsTerminal(child, terminalKey)) ?? false
}

const defaultTopologyExpandedKeys = topologyBranchKeys(buildTopologyBrowserNodes(initialTerminalProfiles))

function endpointById(endpointId: string): RemoteEndpoint {
  const endpoint = remoteEndpoints.find(candidate => candidate.id === endpointId)
  if (!endpoint) throw new Error(`Unknown remote endpoint: ${endpointId}`)
  return endpoint
}

function paneFromProfile(profile: TerminalProfile, id: string): PaneLeaf {
  const endpoint = endpointById(profile.endpointId)
  return {
    type: 'pane',
    id,
    endpointId: endpoint.id,
    endpointLabel: endpoint.label,
    connectionColor: endpoint.color,
    connectionKey: endpoint.connectionKey,
    tmuxInstanceId: endpoint.tmuxInstanceId,
    terminalTitle: profile.terminalTitle,
    host: endpoint.host,
    path: profile.path,
    session: profile.session,
    sessionId: profile.sessionId,
    windowName: profile.windowName,
    remotePaneId: profile.remotePaneId,
    transport: endpoint.transport,
    latency: endpoint.latency,
    detached: false,
  }
}

function unboundPaneFrom(source: PaneLeaf, id: string): PaneLeaf {
  return {
    ...source,
    id,
    terminalTitle: 'Choose terminal',
    remotePaneId: `unbound:${id}`,
    detached: true,
    unbound: true,
  }
}

function createPane(): PaneLeaf {
  const sequence = paneSequence++
  const profile = initialTerminalProfiles[sequence % initialTerminalProfiles.length]
  return paneFromProfile(profile, `prototype-pane-${sequence + 1}`)
}

function remotePaneLabel(pane: PaneLeaf) {
  return `${pane.session}:${pane.windowName} ${pane.remotePaneId}`
}

const OPAQUE_CONNECTION_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

function paneDisplayHost(pane: PaneLeaf) {
  const host = pane.host.trim()
  if (!host || OPAQUE_CONNECTION_ID.test(host)) return ''
  if (host.localeCompare(pane.endpointId, undefined, { sensitivity: 'accent' }) === 0) return ''
  if (host.localeCompare(pane.endpointLabel, undefined, { sensitivity: 'accent' }) === 0) return ''
  return host
}

function paneHeaderTopologyLabel(pane: PaneLeaf) {
  return `${pane.session} / ${pane.windowName} / ${pane.remotePaneId}`
}

function remotePaneKey(pane: Pick<PaneLeaf, 'endpointId' | 'tmuxInstanceId' | 'remotePaneId'>) {
  return `${pane.endpointId}:${pane.tmuxInstanceId}:${pane.remotePaneId}`
}

function terminalProfileKey(profile: TerminalProfile) {
  const tmuxInstanceId = profile.tmuxInstanceId ?? endpointById(profile.endpointId).tmuxInstanceId
  return `${profile.endpointId}:${tmuxInstanceId}:${profile.remotePaneId}`
}

function findPaneLocation(tabs: PrototypeTab[], paneId: string) {
  for (const tab of tabs) {
    const pane = findPane(tab.root, paneId)
    if (pane) return { tab, pane }
  }
  return null
}

function findTerminalLocation(tabs: PrototypeTab[], profile: TerminalProfile, excludedPaneId?: string) {
  const key = terminalProfileKey(profile)
  for (const tab of tabs) {
    const pane = listPanes(tab.root).find(candidate => (
      candidate.id !== excludedPaneId
      && !candidate.detached
      && remotePaneKey(candidate) === key
    ))
    if (pane) return { tab, pane }
  }
  return null
}

function terminalActivitySeedAge(pane: PaneLeaf) {
  if (pane.terminalTitle.includes('worker')) return 9_000
  if (pane.terminalTitle.includes('inference')) return 26_000
  return 1_000
}

function seedTerminalActivity(pane: PaneLeaf, now = Date.now()): TerminalActivityRecord {
  return {
    lastOutputAt: now - terminalActivitySeedAge(pane),
    alert: null,
  }
}

function terminalActivitySnapshot(
  pane: PaneLeaf,
  record: TerminalActivityRecord,
  now: number,
): TerminalActivitySnapshot {
  const elapsed = Math.max(0, now - record.lastOutputAt)
  const secondsSinceOutput = Math.floor(elapsed / 1_000)
  if (pane.detached || record.alert === 'exited') {
    return { state: 'attention', secondsSinceOutput, reason: 'PTY exited' }
  }
  if (record.alert === 'error') {
    return { state: 'attention', secondsSinceOutput, reason: 'Last command returned an error' }
  }
  if (elapsed <= TERMINAL_WORKING_WINDOW_MS) {
    return { state: 'working', secondsSinceOutput, reason: 'Receiving output' }
  }
  if (elapsed <= TERMINAL_ATTENTION_WINDOW_MS) {
    return { state: 'quiet', secondsSinceOutput, reason: 'Temporarily quiet' }
  }
  return { state: 'attention', secondsSinceOutput, reason: 'No recent output' }
}

function formatTerminalActivityAge(seconds: number) {
  if (seconds < 1) return '<1s'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  return `${Math.floor(seconds / 3_600)}h`
}

function createTab(title?: string): PrototypeTab {
  const pane = createPane()
  const index = ++tabSequence
  return {
    id: `prototype-tab-${index}`,
    title: title ?? `shell ${index}`,
    root: pane,
    activePaneId: pane.id,
    maximizedPaneId: null,
  }
}

function createInitialTabs() {
  paneSequence = 0
  splitSequence = 0
  tabSequence = 0
  return [createTab('deploy')]
}

function listPanes(node: LayoutNode): PaneLeaf[] {
  return node.type === 'pane'
    ? [node]
    : [...listPanes(node.first), ...listPanes(node.second)]
}

function findPane(node: LayoutNode, paneId: string): PaneLeaf | null {
  if (node.type === 'pane') return node.id === paneId ? node : null
  return findPane(node.first, paneId) ?? findPane(node.second, paneId)
}

function splitPane(
  node: LayoutNode,
  paneId: string,
  direction: SplitDirection,
  nextPane: PaneLeaf,
  placement: 'before' | 'after' = 'after',
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node
    return {
      type: 'split',
      id: `prototype-split-${++splitSequence}`,
      direction,
      ratio: 0.5,
      first: placement === 'before' ? nextPane : node,
      second: placement === 'before' ? node : nextPane,
    }
  }
  return {
    ...node,
    first: splitPane(node.first, paneId, direction, nextPane, placement),
    second: splitPane(node.second, paneId, direction, nextPane, placement),
  }
}

function mapLayoutPanes(node: LayoutNode, mapper: (pane: PaneLeaf) => PaneLeaf): LayoutNode {
  if (node.type === 'pane') return mapper(node)
  return {
    ...node,
    first: mapLayoutPanes(node.first, mapper),
    second: mapLayoutPanes(node.second, mapper),
  }
}

function updateSplitRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node
  if (node.id === splitId) return { ...node, ratio }
  return {
    ...node,
    first: updateSplitRatio(node.first, splitId, ratio),
    second: updateSplitRatio(node.second, splitId, ratio),
  }
}

function removePane(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === paneId ? null : node
  const first = removePane(node.first, paneId)
  const second = removePane(node.second, paneId)
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

function replacePaneBinding(node: LayoutNode, paneId: string, replacement: PaneLeaf): LayoutNode {
  if (node.type === 'pane') return node.id === paneId ? { ...replacement, id: paneId } : node
  return {
    ...node,
    first: replacePaneBinding(node.first, paneId, replacement),
    second: replacePaneBinding(node.second, paneId, replacement),
  }
}

function terminalPrompt(term: XTerm, pane: PaneLeaf) {
  term.write(`\x1b[38;2;112;165;235mprod@${pane.host}\x1b[0m `)
  term.write(`\x1b[38;2;139;147;158m${pane.path}\x1b[0m `)
  term.write('\x1b[1;37m❯\x1b[0m ')
}

function commandOutput(command: string, pane: PaneLeaf): string[] {
  const trimmed = command.trim()
  if (!trimmed) return []
  if (trimmed === 'help') {
    return [
      '\x1b[38;2;112;165;235mLocal prototype commands\x1b[0m',
      '  status        connection and deployment summary',
      '  ls            list the current directory',
      '  git status    show repository state',
      '  kubectl get pods',
      '  clear         clear this pane',
    ]
  }
  if (trimmed === 'pwd') return [`/srv/tgent/${pane.path.replace('~/', '')}`]
  if (trimmed === 'whoami') return ['prod']
  if (trimmed === 'hostname') return [pane.host]
  if (trimmed === 'date') return [new Date().toString()]
  if (trimmed === 'ls' || trimmed === 'ls -la') {
    return [
      '\x1b[38;2;112;165;235mapp\x1b[0m       config       deploy.sh',
      '\x1b[38;2;112;165;235mlogs\x1b[0m      manifest.json release-notes.md',
    ]
  }
  if (trimmed === 'status' || trimmed === 'deployctl status') {
    return [
      `transport  ${pane.transport.toLowerCase()} · ${pane.latency} ms`,
      'service    ready  restarts',
      'api        3/3    0',
      'worker     6/6    1',
      '\x1b[38;2;117;191;138mrollout stable · revision 8f2c1a\x1b[0m',
    ]
  }
  if (trimmed === 'git status') {
    return [
      'On branch desktop-prototype',
      'Your branch is up to date with origin/main.',
      '',
      '\x1b[38;2;117;191;138mnothing to commit, working tree clean\x1b[0m',
    ]
  }
  if (trimmed === 'kubectl get pods') {
    return [
      'NAME                         READY   STATUS    RESTARTS',
      'api-7f8d9-6k2p4              1/1     Running   0',
      'worker-66b57-td9wx           1/1     Running   1',
      'relay-7b958-fm4q2            1/1     Running   0',
    ]
  }
  if (trimmed.startsWith('echo ')) return [trimmed.slice(5)]
  return [`zsh: command not found: ${trimmed}`, 'type `help` for the local prototype command set']
}

function commandReturnsError(command: string) {
  const trimmed = command.trim()
  if (!trimmed) return false
  return ![
    'help',
    'pwd',
    'whoami',
    'hostname',
    'date',
    'ls',
    'ls -la',
    'status',
    'deployctl status',
    'git status',
    'kubectl get pods',
  ].includes(trimmed) && !trimmed.startsWith('echo ')
}

const MockTerminal = forwardRef<MockTerminalHandle, {
  pane: PaneLeaf
  active: boolean
  onInput: (paneId: string, data: string) => void
  onOutput: (pane: PaneLeaf, alert: TerminalActivityAlert) => void
  onRemoteExit: (paneId: string) => void
}>(({ pane, active, onInput, onOutput, onRemoteExit }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const prepareLayoutChangeRef = useRef<(settleMs?: number) => void>(() => {})
  const inputRef = useRef('')
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const onInputRef = useRef(onInput)
  const onOutputRef = useRef(onOutput)
  const onRemoteExitRef = useRef(onRemoteExit)

  useEffect(() => {
    onInputRef.current = onInput
  }, [onInput])

  useEffect(() => {
    onOutputRef.current = onOutput
  }, [onOutput])

  useEffect(() => {
    onRemoteExitRef.current = onRemoteExit
  }, [onRemoteExit])

  const replaceInput = useCallback((value: string) => {
    const term = terminalRef.current
    if (!term) return
    while (inputRef.current.length > 0) {
      term.write('\b \b')
      inputRef.current = inputRef.current.slice(0, -1)
    }
    inputRef.current = value
    term.write(value)
  }, [])

  const processData = useCallback((data: string) => {
    const term = terminalRef.current
    if (!term) return

    if (data === '\x1b[A') {
      if (!historyRef.current.length) return
      historyIndexRef.current = Math.min(historyIndexRef.current + 1, historyRef.current.length - 1)
      replaceInput(historyRef.current[historyIndexRef.current])
      return
    }
    if (data === '\x1b[B') {
      historyIndexRef.current = Math.max(historyIndexRef.current - 1, -1)
      replaceInput(historyIndexRef.current < 0 ? '' : historyRef.current[historyIndexRef.current])
      return
    }

    for (const char of data) {
      if (char === '\r' || char === '\n') {
        const command = inputRef.current
        term.write('\r\n')
        if (command.trim()) {
          historyRef.current = [command, ...historyRef.current.filter(item => item !== command)].slice(0, 30)
        }
        historyIndexRef.current = -1
        inputRef.current = ''
        if (command.trim() === 'exit') {
          term.writeln('logout')
          onRemoteExitRef.current(pane.id)
          return
        } else if (command.trim() === 'clear') {
          term.clear()
        } else {
          const lines = commandOutput(command, pane)
          for (const line of lines) term.writeln(line)
          if (command.trim()) onOutputRef.current(pane, commandReturnsError(command) ? 'error' : null)
        }
        terminalPrompt(term, pane)
      } else if (char === '\u007f') {
        if (inputRef.current.length > 0) {
          inputRef.current = inputRef.current.slice(0, -1)
          term.write('\b \b')
        }
      } else if (char === '\u0003') {
        term.write('^C\r\n')
        inputRef.current = ''
        terminalPrompt(term, pane)
      } else if (char === '\u000c') {
        term.clear()
        terminalPrompt(term, pane)
        term.write(inputRef.current)
      } else if (char >= ' ') {
        inputRef.current += char
        term.write(char)
      }
    }
  }, [pane, replaceInput])

  useImperativeHandle(ref, () => ({
    focus: () => terminalRef.current?.focus(),
    fit: () => fitRef.current?.fit(),
    syncViewport: () => fitRef.current?.fit(),
    prepareLayoutChange: settleMs => prepareLayoutChangeRef.current(settleMs),
    takeResizeControl: () => {},
    receiveInput: processData,
    reconnect: () => {},
    setFontSize: size => {
      if (!terminalRef.current) return
      terminalRef.current.options.fontSize = size
      fitRef.current?.fit()
    },
    searchNext: () => false,
    searchPrevious: () => false,
    clearSearch: () => {},
    clearScrollback: () => terminalRef.current?.clear(),
  }), [processData])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: "'JetBrainsMono NF', 'SFMono-Regular', Menlo, monospace",
      fontSize: 13,
      fontWeight: '400',
      lineHeight: 1.34,
      letterSpacing: 0,
      scrollback: 3000,
      allowTransparency: false,
      theme: {
        background: '#0d0f12',
        foreground: '#d9dde3',
        cursor: '#eef1f5',
        cursorAccent: '#0d0f12',
        selectionBackground: '#293853',
        black: '#202328',
        red: '#e06c75',
        green: '#75bf8a',
        yellow: '#d8b26e',
        blue: '#70a5eb',
        magenta: '#c28bd8',
        cyan: '#63b3c4',
        white: '#cbd0d8',
        brightBlack: '#6c737d',
        brightRed: '#f07c85',
        brightGreen: '#8bd49c',
        brightYellow: '#e7c67f',
        brightBlue: '#89b4fa',
        brightMagenta: '#d6a3e8',
        brightCyan: '#7dc6d5',
        brightWhite: '#f0f2f5',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    terminalRef.current = term
    fitRef.current = fit
    fit.fit()

    terminalPrompt(term, pane)

    const inputDisposable = term.onData(data => {
      processData(data)
      onInputRef.current(pane.id, data)
    })
    let layoutSettleTimer: ReturnType<typeof setTimeout> | undefined
    let layoutSettleDelay = 180
    let layoutSettling = false
    const commitLayoutChange = () => {
      layoutSettleTimer = undefined
      layoutSettling = false
      delete container.dataset.layoutSettling
      fit.fit()
    }
    const scheduleLayoutCommit = () => {
      clearTimeout(layoutSettleTimer)
      layoutSettleTimer = setTimeout(commitLayoutChange, layoutSettleDelay)
    }
    prepareLayoutChangeRef.current = (settleMs = 180) => {
      layoutSettleDelay = Math.max(80, Math.min(320, settleMs))
      layoutSettling = true
      container.dataset.layoutSettling = 'true'
      scheduleLayoutCommit()
    }
    const observer = new ResizeObserver(() => {
      if (layoutSettling) scheduleLayoutCommit()
      else fit.fit()
    })
    observer.observe(container)
    let disposed = false
    const applyTerminalTheme = (theme: ThemeDefinition) => {
      if (disposed) return
      term.options.theme = {
        ...theme.terminal,
        cursorAccent: theme.terminal.background,
      }
    }
    const onThemeChange = (event: Event) => applyTerminalTheme((event as CustomEvent<ThemeDefinition>).detail)
    void loadThemeId().then(id => applyTerminalTheme(getTheme(id)))
    window.addEventListener('tgent-theme-change', onThemeChange)

    return () => {
      disposed = true
      window.removeEventListener('tgent-theme-change', onThemeChange)
      observer.disconnect()
      clearTimeout(layoutSettleTimer)
      prepareLayoutChangeRef.current = () => {}
      inputDisposable.dispose()
      terminalRef.current = null
      fitRef.current = null
      term.dispose()
    }
  }, [pane, processData])

  useEffect(() => {
    if (active) terminalRef.current?.focus()
  }, [active])

  return <div ref={containerRef} className="desktop-terminal-xterm" />
})

MockTerminal.displayName = 'MockTerminal'

const LiveTerminal = memo(forwardRef<MockTerminalHandle, {
  pane: PaneLeaf
  active: boolean
  visible: boolean
  suspended: boolean
  transport: WebRTCTransport
  onInput: (paneId: string, data: string) => void
  onOutput: (pane: PaneLeaf, alert: TerminalActivityAlert) => void
  onRemoteExit: (paneId: string) => void
  onPasteClipboardImage: (pane: PaneLeaf, image: WailsClipboardImage) => Promise<string>
}>(({ pane, active, visible, suspended, transport, onInput, onOutput, onRemoteExit, onPasteClipboardImage }, ref) => {
  const terminalRef = useRef<TerminalHandle>(null)
  const [resizeState, setResizeState] = useState<TerminalResizeState | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => terminalRef.current?.focus(),
    fit: () => {},
    syncViewport: () => terminalRef.current?.syncViewport(),
    prepareLayoutChange: settleMs => terminalRef.current?.prepareLayoutChange(settleMs),
    takeResizeControl: () => terminalRef.current?.takeResizeControl(),
    receiveInput: data => terminalRef.current?.sendInput(data),
    reconnect: () => terminalRef.current?.reconnect(),
    setFontSize: size => terminalRef.current?.setFontSize(size),
    searchNext: query => terminalRef.current?.searchNext(query) ?? false,
    searchPrevious: query => terminalRef.current?.searchPrevious(query) ?? false,
    clearSearch: () => terminalRef.current?.clearSearch(),
    clearScrollback: () => terminalRef.current?.clearScrollback(),
  }), [])

  useLayoutEffect(() => {
    if (!visible) return
    terminalRef.current?.reactivate()
  }, [visible])

  return (
    <div className="desktop-terminal-xterm">
      {resizeState?.mode === 'observer' && (
        <div className="desktop-terminal-observer" role="status">
          <span>
            Viewing {resizeState.columns}&times;{resizeState.rows}
            {resizeState.scale < 0.995 ? ` · ${Math.round(resizeState.scale * 100)}%` : ''}
          </span>
          <button
            type="button"
            title="Take control of the tmux pane size"
            aria-label="Take control of the tmux pane size"
            onPointerDown={event => event.stopPropagation()}
            onClick={() => terminalRef.current?.takeResizeControl()}
          >
            <Maximize2 size={11} aria-hidden="true" />
          </button>
        </div>
      )}
      <Terminal
        ref={terminalRef}
        paneId={pane.remotePaneId}
        webrtcTransport={transport}
        preventFocus={!active}
        suspended={suspended}
        onInput={data => onInput(pane.id, data)}
        onOutputActivity={() => onOutput(pane, null)}
        onResizeStateChange={setResizeState}
        onPaneClosed={() => onRemoteExit(pane.id)}
        onPasteClipboardImage={image => onPasteClipboardImage(pane, image)}
        onConnStatusChange={status => {
          if (status === 'disconnected') onOutput(pane, 'error')
        }}
      />
    </div>
  )
}))

LiveTerminal.displayName = 'LiveTerminal'

const paneDropIntents: PaneDropIntent[] = ['replace', 'left', 'right', 'top', 'bottom']

const paneDropLabels: Record<PaneDropIntent, string> = {
  replace: 'Replace this view',
  left: 'Split left',
  right: 'Split right',
  top: 'Split above',
  bottom: 'Split below',
}

const restrictDragOverlayToViewport: Modifier = ({ transform, overlayNodeRect, windowRect }) => {
  if (!overlayNodeRect || !windowRect) return transform
  const margin = 8
  return {
    ...transform,
    x: Math.min(
      Math.max(transform.x, windowRect.left - overlayNodeRect.left + margin),
      windowRect.right - overlayNodeRect.right - margin,
    ),
    y: Math.min(
      Math.max(transform.y, windowRect.top - overlayNodeRect.top + margin),
      windowRect.bottom - overlayNodeRect.bottom - margin,
    ),
  }
}

function PaneDropTarget({ paneId, intent, disabled }: { paneId: string; intent: PaneDropIntent; disabled: boolean }) {
  const { setNodeRef } = useDroppable({
    id: `pane-drop:${paneId}:${intent}`,
    data: { type: 'pane-drop', paneId, intent } satisfies PaneDropData,
    disabled,
  })

  return <span ref={setNodeRef} className={`desktop-pane-drop-target is-${intent}`} aria-hidden="true" />
}

function PaneDropLayer({
  paneId,
  profile,
  preview,
}: {
  paneId: string
  profile: TerminalProfile | null
  preview: PaneDropPreview | null
}) {
  if (!profile) return null
  const visiblePreview = preview?.paneId === paneId ? preview : null

  return (
    <div className="desktop-pane-drop-layer" aria-hidden="true">
      {paneDropIntents.map(intent => (
        <PaneDropTarget key={intent} paneId={paneId} intent={intent} disabled={!profile} />
      ))}
      {visiblePreview && (
        <div className={`desktop-pane-drop-preview is-${visiblePreview.intent}`} data-testid="pane-drop-preview">
          <span className="desktop-pane-drop-copy">
            <strong>{paneDropLabels[visiblePreview.intent]}</strong>
            <span>{profile.terminalTitle}</span>
            <small>
              {visiblePreview.pixelWidth}×{visiblePreview.pixelHeight}px
              <i>·</i>
              {visiblePreview.columns}×{visiblePreview.rows}
            </small>
          </span>
        </div>
      )}
    </div>
  )
}

function PaneView({
  pane,
  active,
  visible,
  suspended,
  broadcastTarget,
  draggedProfile,
  dropPreview,
  onActivate,
  onInput,
  onOutput,
  onRemoteExit,
  onPasteClipboardImage,
  onRebind,
  onClose,
  closeShortcut,
  onContextMenu,
  registerTerminal,
  transport,
  allowPrototypeTerminal,
}: {
  pane: PaneLeaf
  active: boolean
  visible: boolean
  suspended: boolean
  broadcastTarget: boolean
  draggedProfile: TerminalProfile | null
  dropPreview: PaneDropPreview | null
  onActivate: (paneId: string) => void
  onInput: (paneId: string, data: string) => void
  onOutput: (pane: PaneLeaf, alert: TerminalActivityAlert) => void
  onRemoteExit: (paneId: string) => void
  onPasteClipboardImage: (pane: PaneLeaf, image: WailsClipboardImage) => Promise<string>
  onRebind: (paneId: string) => void
  onClose: (paneId: string) => void
  closeShortcut?: string
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, paneId: string) => void
  registerTerminal: (paneId: string, handle: MockTerminalHandle | null) => void
  transport?: WebRTCTransport
  allowPrototypeTerminal: boolean
}) {
  const displayHost = paneDisplayHost(pane)
  const topologyLabel = paneHeaderTopologyLabel(pane)
  return (
    <section
      className={`desktop-terminal-pane ${active ? 'is-active' : ''}`}
      data-pane-id={pane.id}
      aria-label={`${pane.endpointLabel} terminal pane${pane.detached ? ', detached' : ''}`}
      onPointerDown={() => onActivate(pane.id)}
      onContextMenu={event => onContextMenu(event, pane.id)}
    >
      <header
        className="desktop-pane-header"
        style={{ '--connection-color': pane.connectionColor } as CSSProperties}
        title={[pane.endpointLabel, displayHost, pane.transport, `${pane.latency} ms`].filter(Boolean).join(' · ')}
      >
        <span className="desktop-pane-focus-mark" aria-hidden="true">&#10095;</span>
        <span className={`desktop-pane-connection-mark ${pane.detached ? 'is-detached' : ''}`} aria-hidden="true" />
        <strong className="desktop-pane-connection-name">{pane.endpointLabel}</strong>
        {displayHost && (
          <>
            <span className="desktop-pane-separator" aria-hidden="true">·</span>
            <span className="desktop-pane-host">{displayHost}</span>
          </>
        )}
        <span className="desktop-pane-separator" aria-hidden="true">·</span>
        <span className="desktop-pane-context" title={topologyLabel}>
          {topologyLabel}{pane.detached ? ' · detached' : ''}
        </span>
        <span className="desktop-pane-spacer" />
        {broadcastTarget && !pane.detached && (
          <span className="desktop-pane-broadcast" title="Receiving broadcast input">
            <Radio size={11} /><span>sync</span>
          </span>
        )}
        <button
          type="button"
          className="desktop-pane-close"
          aria-label={`Close panel view${closeShortcut ? ` (${closeShortcut})` : ''}`}
          title={`Close panel view${closeShortcut ? ` (${closeShortcut})` : ''}`}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation()
            onClose(pane.id)
          }}
        >
          <X size={11} aria-hidden="true" />
        </button>
      </header>
      <div className="desktop-pane-terminal" onPointerDown={() => onActivate(pane.id)}>
        {pane.unbound ? (
          <div className="desktop-pane-detached is-unbound" role="status">
            <SquareTerminal size={17} aria-hidden="true" />
            <strong>Choose a terminal</strong>
            <span>This tab is not attached to the terminal pool yet.</span>
            <div>
              <button type="button" onClick={() => onRebind(pane.id)}>
                <Search size={13} aria-hidden="true" />
                <span>Open Terminal Picker</span>
              </button>
            </div>
          </div>
        ) : pane.detached ? (
          <div className="desktop-pane-detached" role="status">
            <SquareTerminal size={17} aria-hidden="true" />
            <strong>tmux pane {pane.remotePaneId} ended</strong>
            <span>{pane.endpointLabel} · {pane.session} / {pane.windowName}</span>
            <div>
              <button type="button" onClick={() => onRebind(pane.id)}>
                <RefreshCw size={13} aria-hidden="true" />
                <span>Choose terminal</span>
              </button>
              <button type="button" onClick={() => onClose(pane.id)}>
                <X size={13} aria-hidden="true" />
                <span>Close view</span>
              </button>
            </div>
          </div>
        ) : (
          transport ? (
            <LiveTerminal
              key={`${pane.endpointId}:${pane.tmuxInstanceId}:${pane.remotePaneId}`}
              ref={handle => registerTerminal(pane.id, handle)}
              pane={pane}
              active={active}
              visible={visible}
              suspended={suspended}
              transport={transport}
              onInput={onInput}
              onOutput={onOutput}
              onRemoteExit={onRemoteExit}
              onPasteClipboardImage={onPasteClipboardImage}
            />
          ) : allowPrototypeTerminal ? (
            <MockTerminal
              ref={handle => registerTerminal(pane.id, handle)}
              pane={pane}
              active={active}
              onInput={onInput}
              onOutput={onOutput}
              onRemoteExit={onRemoteExit}
            />
          ) : (
            // The live desktop workspace never substitutes a second xterm
            // implementation while its shared Terminal transport reconnects.
            <div className="desktop-terminal-xterm" aria-hidden="true" />
          )
        )}
      </div>
      <PaneDropLayer paneId={pane.id} profile={draggedProfile} preview={dropPreview} />
    </section>
  )
}

interface PaneLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

interface PaneLayoutLeaf {
  pane: PaneLeaf
  rect: PaneLayoutRect
}

interface PaneLayoutDivider {
  splitId: string
  direction: SplitDirection
  ratio: number
  bounds: PaneLayoutRect
  position: number
}

function calculatePaneLayout(node: LayoutNode) {
  const leaves: PaneLayoutLeaf[] = []
  const dividers: PaneLayoutDivider[] = []

  const visit = (current: LayoutNode, bounds: PaneLayoutRect) => {
    if (current.type === 'pane') {
      leaves.push({ pane: current, rect: bounds })
      return
    }

    const horizontal = current.direction === 'horizontal'
    const first: PaneLayoutRect = horizontal
      ? { ...bounds, height: bounds.height * current.ratio }
      : { ...bounds, width: bounds.width * current.ratio }
    const second: PaneLayoutRect = horizontal
      ? {
          x: bounds.x,
          y: bounds.y + first.height,
          width: bounds.width,
          height: bounds.height - first.height,
        }
      : {
          x: bounds.x + first.width,
          y: bounds.y,
          width: bounds.width - first.width,
          height: bounds.height,
        }

    dividers.push({
      splitId: current.id,
      direction: current.direction,
      ratio: current.ratio,
      bounds,
      position: horizontal ? second.y : second.x,
    })
    visit(current.first, first)
    visit(current.second, second)
  }

  visit(node, { x: 0, y: 0, width: 1, height: 1 })
  return { leaves, dividers }
}

function percent(value: number) {
  return `${value * 100}%`
}

function PaneTree({
  node,
  activePaneId,
  visible = true,
  suspended = false,
  broadcastTargetKeys,
  draggedProfile,
  dropPreview,
  onActivate,
  onInput,
  onOutput,
  onRemoteExit,
  onPasteClipboardImage,
  onRebind,
  onClose,
  closeShortcut,
  onRatioChange,
  onContextMenu,
  registerTerminal,
  transport,
  resolveTransport,
  allowPrototypeTerminal = false,
}: {
  node: LayoutNode
  activePaneId: string
  visible?: boolean
  suspended?: boolean
  maximizedPaneId: string | null
  broadcastTargetKeys: Set<string>
  draggedProfile: TerminalProfile | null
  dropPreview: PaneDropPreview | null
  onActivate: (paneId: string) => void
  onInput: (paneId: string, data: string) => void
  onOutput: (pane: PaneLeaf, alert: TerminalActivityAlert) => void
  onRemoteExit: (paneId: string) => void
  onPasteClipboardImage: (pane: PaneLeaf, image: WailsClipboardImage) => Promise<string>
  onRebind: (paneId: string) => void
  onSplit: (paneId: string, direction: SplitDirection) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  closeShortcut?: string
  onRatioChange: (splitId: string, ratio: number) => void
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, paneId: string) => void
  registerTerminal: (paneId: string, handle: MockTerminalHandle | null) => void
  transport?: WebRTCTransport
  resolveTransport?: (endpointId: string) => WebRTCTransport | undefined
  allowPrototypeTerminal?: boolean
}) {
  const layout = useMemo(() => calculatePaneLayout(node), [node])

  const handleDividerPointerDown = (divider: PaneLayoutDivider, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    const container = target.parentElement
    if (!container) return
    target.setPointerCapture(event.pointerId)
    const rootRect = container.getBoundingClientRect()
    const nodeRect = {
      left: rootRect.left + divider.bounds.x * rootRect.width,
      top: rootRect.top + divider.bounds.y * rootRect.height,
      width: divider.bounds.width * rootRect.width,
      height: divider.bounds.height * rootRect.height,
    }
    const horizontal = divider.direction === 'horizontal'
    const move = (moveEvent: PointerEvent) => {
      const position = horizontal
        ? (moveEvent.clientY - nodeRect.top) / nodeRect.height
        : (moveEvent.clientX - nodeRect.left) / nodeRect.width
      onRatioChange(divider.splitId, Math.min(0.82, Math.max(0.18, position)))
    }
    const finish = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div className="desktop-pane-layout">
      {layout.leaves.map(({ pane, rect }) => (
        <div
          key={pane.id}
          className="desktop-pane-leaf"
          style={{ left: percent(rect.x), top: percent(rect.y), width: percent(rect.width), height: percent(rect.height) }}
        >
          <PaneView
            pane={pane}
            active={pane.id === activePaneId}
            visible={visible}
            suspended={suspended}
            broadcastTarget={broadcastTargetKeys.has(remotePaneKey(pane))}
            draggedProfile={draggedProfile}
            dropPreview={dropPreview}
            onActivate={onActivate}
            onInput={onInput}
            onOutput={onOutput}
            onRemoteExit={onRemoteExit}
            onPasteClipboardImage={onPasteClipboardImage}
            onRebind={onRebind}
            onClose={onClose}
            closeShortcut={closeShortcut}
            onContextMenu={onContextMenu}
            registerTerminal={registerTerminal}
            transport={resolveTransport?.(pane.endpointId) ?? transport}
            allowPrototypeTerminal={allowPrototypeTerminal}
          />
        </div>
      ))}
      {layout.dividers.map(divider => {
        const horizontal = divider.direction === 'horizontal'
        const style = horizontal
          ? {
              left: percent(divider.bounds.x),
              top: percent(divider.position),
              width: percent(divider.bounds.width),
              height: '1px',
            }
          : {
              left: percent(divider.position),
              top: percent(divider.bounds.y),
              width: '1px',
              height: percent(divider.bounds.height),
            }
        return (
          <div
            key={divider.splitId}
            className={`desktop-pane-divider ${horizontal ? 'is-horizontal' : 'is-vertical'}`}
            style={style}
            role="separator"
            aria-label={`Resize ${horizontal ? 'horizontal' : 'vertical'} split`}
            aria-orientation={horizontal ? 'horizontal' : 'vertical'}
            tabIndex={0}
            onPointerDown={event => handleDividerPointerDown(divider, event)}
            onDoubleClick={() => onRatioChange(divider.splitId, 0.5)}
            onKeyDown={event => {
              const delta = event.shiftKey ? 0.1 : 0.04
              if ((!horizontal && event.key === 'ArrowLeft') || (horizontal && event.key === 'ArrowUp')) {
                event.preventDefault()
                onRatioChange(divider.splitId, Math.max(0.18, divider.ratio - delta))
              }
              if ((!horizontal && event.key === 'ArrowRight') || (horizontal && event.key === 'ArrowDown')) {
                event.preventDefault()
                onRatioChange(divider.splitId, Math.min(0.82, divider.ratio + delta))
              }
            }}
          >
            <span />
          </div>
        )
      })}
    </div>
  )
}

function TabActivityDots({
  panes,
  activityRecords,
}: {
  panes: PaneLeaf[]
  activityRecords: Record<string, TerminalActivityRecord>
}) {
  const [now, setNow] = useState(Date.now())
  const snapshots = panes.map(pane => ({
    pane,
    snapshot: terminalActivitySnapshot(
      pane,
      activityRecords[remotePaneKey(pane)] ?? seedTerminalActivity(pane, now),
      now,
    ),
  }))
  const title = snapshots.map(({ pane, snapshot }) => (
    `${pane.terminalTitle}: ${snapshot.reason.toLowerCase()} (${formatTerminalActivityAge(snapshot.secondsSinceOutput)})`
  )).join('\n')

  useEffect(() => {
    const delays = panes.flatMap(pane => {
      const record = activityRecords[remotePaneKey(pane)] ?? seedTerminalActivity(pane, now)
      const elapsed = Math.max(0, now - record.lastOutputAt)
      if (pane.detached || record.alert || elapsed > TERMINAL_ATTENTION_WINDOW_MS) return []
      const boundary = elapsed <= TERMINAL_WORKING_WINDOW_MS
        ? TERMINAL_WORKING_WINDOW_MS
        : TERMINAL_ATTENTION_WINDOW_MS
      return [Math.max(80, boundary - elapsed + 20)]
    })
    if (!delays.length) return
    const timeout = window.setTimeout(() => setNow(Date.now()), Math.min(...delays))
    return () => window.clearTimeout(timeout)
  }, [activityRecords, now, panes])

  return (
    <span
      className={`desktop-tab-activity ${snapshots.length > 1 ? 'is-multiple' : ''}`}
      title={title}
      aria-label={title}
    >
      {snapshots.map(({ pane, snapshot }) => (
        <i
          key={pane.id}
          className={`is-${snapshot.state}`}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}

function TerminalWatchStrip({
  terminals,
  activeTabId,
  activePaneId,
  onSelect,
}: {
  terminals: MonitoredTerminal[]
  activeTabId: string
  activePaneId: string
  onSelect: (terminal: MonitoredTerminal) => void
}) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!terminals.length) return
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [terminals.length])

  if (!terminals.length) return null
  return (
    <nav className="desktop-terminal-watch" aria-label="Observed terminal activity">
      {terminals.map(terminal => {
        const activity = terminalActivitySnapshot(terminal.pane, terminal.activity, now)
        const current = terminal.tabId === activeTabId && terminal.pane.id === activePaneId
        const age = formatTerminalActivityAge(activity.secondsSinceOutput)
        const stateLabel = activity.state === 'working'
          ? 'working'
          : activity.state === 'quiet'
            ? 'quiet'
            : 'needs attention'
        const label = `Open ${terminal.pane.terminalTitle}, ${stateLabel}, ${activity.reason.toLowerCase()}, last output ${age} ago`
        return (
          <button
            key={terminal.key}
            type="button"
            className={`desktop-terminal-watch-item is-${activity.state} ${current ? 'is-current' : ''}`}
            data-activity-state={activity.state}
            data-terminal-key={terminal.key}
            aria-current={current ? 'true' : undefined}
            aria-label={label}
            title={`${terminal.pane.terminalTitle} · ${terminal.pane.host}\n${activity.reason} · last output ${age} ago`}
            onClick={() => onSelect(terminal)}
          >
            <span className="desktop-terminal-watch-signal" aria-hidden="true">
              {activity.state === 'working'
                ? <Activity size={10} />
                : activity.state === 'quiet'
                  ? <Pause size={9} />
                  : <TriangleAlert size={10} />}
            </span>
            <span className="desktop-terminal-watch-age" aria-hidden="true">{age}</span>
          </button>
        )
      })}
    </nav>
  )
}

function BroadcastTargetPicker({
  candidates,
  selectedKeys,
  active,
  onToggle,
  onApply,
  onStop,
  onClose,
}: {
  candidates: BroadcastCandidate[]
  selectedKeys: Set<string>
  active: boolean
  onToggle: (key: string) => void
  onApply: () => void
  onStop: () => void
  onClose: () => void
}) {
  return (
    <div className="desktop-broadcast-layer" onPointerDown={onClose}>
      <aside
        className="desktop-broadcast-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Broadcast targets"
        onPointerDown={event => event.stopPropagation()}
      >
        <header>
          <div>
            <Radio size={14} aria-hidden="true" />
            <strong>Broadcast input</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Close broadcast targets"><X size={14} /></button>
        </header>
        <div className="desktop-broadcast-targets">
          {candidates.map(({ key, pane }) => {
            const selected = selectedKeys.has(key)
            return (
              <button
                key={key}
                type="button"
                role="checkbox"
                aria-checked={selected}
                aria-label={`${pane.terminalTitle}, ${pane.endpointLabel}, ${pane.host}, ${remotePaneLabel(pane)}`}
                onClick={() => onToggle(key)}
              >
                <span className={`desktop-broadcast-check ${selected ? 'is-selected' : ''}`} aria-hidden="true">
                  {selected && <Check size={11} />}
                </span>
                <span className="desktop-broadcast-identity">
                  <strong>{pane.terminalTitle}</strong>
                  <small>{pane.endpointLabel} · {pane.host}</small>
                </span>
                <span className="desktop-broadcast-topology">{remotePaneLabel(pane)}</span>
              </button>
            )
          })}
        </div>
        <footer>
          <span>{selectedKeys.size} selected</span>
          <div>
            {active && <button type="button" className="is-stop" onClick={onStop}>Stop</button>}
            <button type="button" className="is-apply" disabled={selectedKeys.size < 2} onClick={onApply}>
              {active ? 'Apply' : 'Start'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  )
}

function TopologyTreeRow({
  node,
  expandedKeys,
  connectedEndpointIds,
  checkingEndpointIds,
  currentTerminalKey,
  onToggle,
  onSelect,
  onOpenActions,
  onDismissActions,
  autoFocus = false,
}: {
  node: TopologyBrowserNode
  expandedKeys: Set<string>
  connectedEndpointIds: Set<string>
  checkingEndpointIds: Set<string>
  currentTerminalKey: string
  onToggle: (key: string) => void
  onSelect: (profile: TerminalProfile) => void
  onOpenActions: (node: TopologyBrowserNode, anchor: DOMRect) => void
  onDismissActions: () => void
  autoFocus?: boolean
}) {
  const branch = Boolean(node.children?.length)
  const expanded = branch && expandedKeys.has(node.key)
  const current = node.profile ? terminalProfileKey(node.profile) === currentTerminalKey : false
  const currentPath = topologyNodeContainsTerminal(node, currentTerminalKey)
  const connected = connectedEndpointIds.has(node.endpointId)
  const checking = checkingEndpointIds.has(node.endpointId)
  const draggable = Boolean(node.profile && connected)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `topology-drag:${node.key}`,
    data: node.profile ? { type: 'topology-pane', profile: node.profile } satisfies TopologyDragData : undefined,
    disabled: !draggable,
  })

  return (
    <div className={`desktop-topology-node is-${node.kind} ${currentPath ? 'is-current-path' : ''} ${current ? 'is-current' : ''} ${isDragging ? 'is-dragging' : ''}`} role="none">
      <div className="desktop-topology-row" role="none">
        <button
          ref={setNodeRef}
          type="button"
          {...(draggable ? attributes : {})}
          {...(draggable ? listeners : {})}
          role="treeitem"
          autoFocus={autoFocus}
          aria-expanded={branch ? expanded : undefined}
          aria-selected={node.kind === 'pane' ? current : undefined}
          aria-disabled={node.kind === 'pane' && !connected ? true : undefined}
          className={`desktop-topology-main ${current ? 'is-current' : ''} ${!connected && !checking ? 'is-offline' : ''}`}
          title={node.kind === 'pane' && !connected ? 'Connect before dragging' : undefined}
          onClick={() => {
            onDismissActions()
            if (branch) onToggle(node.key)
            else if (node.profile) onSelect(node.profile)
          }}
        >
          <span className="desktop-topology-disclosure" aria-hidden="true">
            {branch ? <ChevronRight size={12} className={expanded ? 'is-expanded' : ''} /> : null}
          </span>
          <span className={`desktop-topology-kind-icon is-${node.kind}`} aria-hidden="true">
            {node.kind === 'endpoint' && <Server size={14} />}
            {node.kind === 'session' && <Layers3 size={13} />}
            {node.kind === 'window' && <AppWindow size={13} />}
            {node.kind === 'pane' && <SquareTerminal size={12} />}
            {node.kind === 'endpoint' && (
              <span className={`desktop-topology-status ${connected ? 'is-connected' : checking ? 'is-checking' : 'is-offline'}`} />
            )}
          </span>
          <span className="desktop-topology-node-text">
            <strong>{node.label}</strong>
            <small>{node.meta}{node.kind === 'endpoint' && !connected ? checking ? ' · Checking' : ' · Offline' : ''}</small>
          </span>
          <span className="desktop-topology-node-mark" aria-hidden={!current}>
            {current ? <Check size={12} className="desktop-topology-current" /> : node.kind === 'pane' && connected ? <GripVertical size={12} /> : null}
          </span>
        </button>
        <button
          type="button"
          className="desktop-topology-actions"
          aria-label={`Actions for ${node.kind} ${node.label}`}
          aria-haspopup="menu"
          onClick={event => {
            event.stopPropagation()
            onOpenActions(node, event.currentTarget.getBoundingClientRect())
          }}
        >
          <MoreHorizontal size={13} aria-hidden="true" />
        </button>
      </div>
      {branch && expanded && (
        <div className="desktop-topology-group" role="group">
          {node.children!.map(child => (
            <TopologyTreeRow
              key={child.key}
              node={child}
              expandedKeys={expandedKeys}
              connectedEndpointIds={connectedEndpointIds}
              checkingEndpointIds={checkingEndpointIds}
              currentTerminalKey={currentTerminalKey}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpenActions={onOpenActions}
              onDismissActions={onDismissActions}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TopologyActionMenu({
  node,
  x,
  y,
  onAction,
  onClose,
}: {
  node: TopologyBrowserNode
  x: number
  y: number
  onAction: (action: TopologyAction, node: TopologyBrowserNode) => void
  onClose: () => void
}) {
  const run = (action: TopologyAction) => {
    onClose()
    onAction(action, node)
  }

  return (
    <div
      className="desktop-topology-action-menu"
      role="menu"
      aria-label={`${node.label} actions`}
      style={{ left: x, top: y }}
      onPointerDown={event => event.stopPropagation()}
    >
      {node.kind === 'pane' ? (
        <>
          <button type="button" role="menuitem" onClick={() => run('open')}><SquareTerminal size={14} /><span>Open here</span></button>
          <button type="button" role="menuitem" onClick={() => run('split-right')}><Columns2 size={14} /><span>Split right</span></button>
          <button type="button" role="menuitem" onClick={() => run('split-below')}><Rows2 size={14} /><span>Split below</span></button>
          <div className="desktop-menu-divider" />
        </>
      ) : (
        <button type="button" role="menuitem" onClick={() => run('create')}>
          <Plus size={14} />
          <span>{node.kind === 'endpoint' ? 'New session' : node.kind === 'session' ? 'New window' : 'New pane'}</span>
        </button>
      )}
      <button type="button" role="menuitem" onClick={() => run(node.kind === 'endpoint' ? 'edit-connection' : 'rename')}>
        <Pencil size={14} /><span>{node.kind === 'endpoint' ? 'Edit connection' : node.kind === 'pane' ? 'Rename terminal' : `Rename ${node.kind}`}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run('refresh')}><RefreshCw size={14} /><span>Refresh</span></button>
      <div className="desktop-menu-divider" />
      <button type="button" role="menuitem" className="is-danger" onClick={() => run('delete')}>
        <Trash2 size={14} />
        <span>{node.kind === 'endpoint' ? 'Remove connection' : `Kill ${node.kind}`}</span>
      </button>
    </div>
  )
}

function TopologyBrowser({
  targetPane,
  nodes,
  paneCount,
  expandedKeys,
  connectedEndpointIds,
  checkingEndpointIds,
  onToggle,
  onSelect,
  onAction,
  onClose,
}: {
  targetPane: PaneLeaf
  nodes: TopologyBrowserNode[]
  paneCount: number
  expandedKeys: Set<string>
  connectedEndpointIds: Set<string>
  checkingEndpointIds: Set<string>
  onToggle: (key: string) => void
  onSelect: (profile: TerminalProfile) => void
  onAction: (action: TopologyAction, node: TopologyBrowserNode) => void
  onClose: () => void
}) {
  const [actionMenu, setActionMenu] = useState<{ node: TopologyBrowserNode; x: number; y: number } | null>(null)

  const openActions = (node: TopologyBrowserNode, anchor: DOMRect) => {
    setActionMenu({
      node,
      x: Math.max(8, Math.min(anchor.right - 214, window.innerWidth - 222)),
      y: Math.max(48, Math.min(anchor.bottom + 2, window.innerHeight - 250)),
    })
  }

  return (
    <div className="desktop-topology-layer" onPointerDown={onClose}>
      <aside
        className="desktop-topology-browser"
        role="dialog"
        aria-modal="true"
        aria-label="Tmux topology"
        onPointerDown={event => event.stopPropagation()}
      >
        <header>
          <div>
            <Network size={14} aria-hidden="true" />
            <span className="desktop-topology-heading">
              <strong>Topology</strong>
              <small>{nodes.length} connections · {paneCount} panes</small>
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close tmux topology"><X size={14} /></button>
        </header>
        <div className="desktop-topology-tree" role="tree" aria-label="Remote tmux hierarchy" onPointerDown={() => setActionMenu(null)}>
          {nodes.map((node, index) => (
            <TopologyTreeRow
              key={node.key}
              node={node}
              expandedKeys={expandedKeys}
              connectedEndpointIds={connectedEndpointIds}
              checkingEndpointIds={checkingEndpointIds}
              currentTerminalKey={remotePaneKey(targetPane)}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpenActions={openActions}
              onDismissActions={() => setActionMenu(null)}
              autoFocus={index === 0}
            />
          ))}
        </div>
        {actionMenu && (
          <TopologyActionMenu
            {...actionMenu}
            onAction={onAction}
            onClose={() => setActionMenu(null)}
          />
        )}
      </aside>
    </div>
  )
}

function TopologyMutationDialog({
  state,
  onChange,
  onCommit,
  onClose,
}: {
  state: TopologyMutationState
  onChange: (value: string) => void
  onCommit: () => void
  onClose: () => void
}) {
  const nextKind = state.node.kind === 'endpoint' ? 'session' : state.node.kind === 'session' ? 'window' : 'pane'
  const title = state.mode === 'create'
    ? `New ${nextKind}`
    : state.mode === 'rename'
      ? `Rename ${state.node.kind === 'pane' ? 'terminal' : state.node.kind}`
      : state.node.kind === 'endpoint'
        ? 'Remove connection'
        : `Kill ${state.node.kind}`
  const destructiveCopy = state.node.kind === 'endpoint'
    ? `Remove ${state.node.label} from this desktop? Bound local views will become detached.`
    : `Kill ${state.node.kind} ${state.node.label}? Any bound local views will become detached.`

  return (
    <div className="desktop-topology-mutation-layer" onPointerDown={onClose}>
      <form
        className={`desktop-topology-mutation ${state.mode === 'delete' ? 'is-destructive' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={event => event.stopPropagation()}
        onSubmit={event => {
          event.preventDefault()
          onCommit()
        }}
      >
        <header>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={14} /></button>
        </header>
        {state.mode === 'delete' ? (
          <p>{destructiveCopy}</p>
        ) : (
          <label>
            <span>{state.mode === 'create' ? `${nextKind} name` : 'New name'}</span>
            <input
              autoFocus
              value={state.value}
              onChange={event => onChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onClose()
                }
              }}
              spellCheck={false}
              placeholder={nextKind === 'pane' ? 'terminal title' : `${nextKind} name`}
            />
          </label>
        )}
        <footer>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className={state.mode === 'delete' ? 'is-danger' : 'is-primary'} disabled={state.mode !== 'delete' && !state.value.trim()}>
            {state.mode === 'create' ? 'Create' : state.mode === 'rename' ? 'Save' : state.node.kind === 'endpoint' ? 'Remove' : 'Kill'}
          </button>
        </footer>
      </form>
    </div>
  )
}

export default function DesktopTerminalPrototype() {
  const [tabs, setTabs] = useState<PrototypeTab[]>(createInitialTabs)
  const activityBaselineRef = useRef(Date.now())
  const [terminalActivity, setTerminalActivity] = useState<Record<string, TerminalActivityRecord>>(() => {
    const records: Record<string, TerminalActivityRecord> = {}
    tabs.forEach(tab => listPanes(tab.root).forEach(pane => {
      records[remotePaneKey(pane)] = seedTerminalActivity(pane, activityBaselineRef.current)
    }))
    return records
  })
  const [followedTerminalKeys, setFollowedTerminalKeys] = useState<Set<string>>(loadFollowedTerminalKeys)
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>(() => initialTerminalProfiles.map(profile => ({ ...profile })))
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [broadcast, setBroadcast] = useState(false)
  const [broadcastTargetsOpen, setBroadcastTargetsOpen] = useState(false)
  const [broadcastTargetKeys, setBroadcastTargetKeys] = useState<Set<string>>(() => new Set())
  const [broadcastDraftKeys, setBroadcastDraftKeys] = useState<Set<string>>(() => new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [mainMenuOpen, setMainMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const [topologyOpen, setTopologyOpen] = useState(false)
  const [topologyExpandedKeys, setTopologyExpandedKeys] = useState<Set<string>>(
    () => new Set(defaultTopologyExpandedKeys),
  )
  const [hiddenEndpointIds, setHiddenEndpointIds] = useState<Set<string>>(() => new Set())
  const [draggedProfile, setDraggedProfile] = useState<TerminalProfile | null>(null)
  const [dropPreview, setDropPreview] = useState<PaneDropPreview | null>(null)
  const [topologyMutation, setTopologyMutation] = useState<TopologyMutationState | null>(null)
  const [selectedFile, setSelectedFile] = useState('manifest.json')
  const [terminalPickerPaneId, setTerminalPickerPaneId] = useState<string | null>(null)
  const [terminalQuery, setTerminalQuery] = useState('')
  const [terminalPickerIndex, setTerminalPickerIndex] = useState(0)
  const [terminalPickerCreating, setTerminalPickerCreating] = useState(false)
  const [terminalPickerCreateError, setTerminalPickerCreateError] = useState('')
  const [terminalPickerConnectingId, setTerminalPickerConnectingId] = useState<string | null>(null)
  const [terminalPickerError, setTerminalPickerError] = useState<PickerConnectionError | null>(null)
  const [connectedEndpointIds, setConnectedEndpointIds] = useState<Set<string>>(
    () => new Set(remoteEndpoints.filter(endpoint => endpoint.initialStatus === 'connected').map(endpoint => endpoint.id)),
  )
  const [notice, setNotice] = useState<string | null>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const terminalPickerRef = useRef<HTMLDivElement>(null)
  const terminalPickerInputRef = useRef<HTMLInputElement>(null)
  const terminalPickerRequestRef = useRef(0)
  const terminalPickerTimerRef = useRef<number | null>(null)
  const endpointConnectionAttemptsRef = useRef(new Map<string, number>())
  const terminalsRef = useRef(new Map<string, MockTerminalHandle>())
  const topologySequenceRef = useRef(initialTerminalProfiles.length)
  const pendingTabRef = useRef<{ tabId: string; paneId: string; previousTabId: string; previousPaneId: string } | null>(null)
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const panes = useMemo(() => listPanes(activeTab.root), [activeTab.root])
  const activePane = findPane(activeTab.root, activeTab.activePaneId) ?? panes[0]
  const contextPane = contextMenu ? panes.find(pane => pane.id === contextMenu.paneId) ?? null : null
  const monitoredTerminals = useMemo(() => {
    const seen = new Set<string>()
    return tabs.flatMap<MonitoredTerminal>(tab => listPanes(tab.root).flatMap(pane => {
      const key = remotePaneKey(pane)
      if (!followedTerminalKeys.has(key) || seen.has(key)) return []
      seen.add(key)
      const record = terminalActivity[key] ?? seedTerminalActivity(pane, activityBaselineRef.current)
      return [{
        key,
        tabId: tab.id,
        tabTitle: tab.title,
        pane,
        activity: record,
      }]
    }))
  }, [followedTerminalKeys, tabs, terminalActivity])
  const topologyBrowserNodes = useMemo(
    () => buildTopologyBrowserNodes(terminalProfiles, remoteEndpoints.filter(endpoint => !hiddenEndpointIds.has(endpoint.id))),
    [hiddenEndpointIds, terminalProfiles],
  )
  const broadcastCandidates = useMemo(() => {
    const seen = new Set<string>()
    return panes.reduce<BroadcastCandidate[]>((candidates, pane) => {
      if (pane.detached) return candidates
      const key = remotePaneKey(pane)
      if (seen.has(key)) return candidates
      seen.add(key)
      candidates.push({ key, pane })
      return candidates
    }, [])
  }, [panes])
  const terminalPickerTargetPane = terminalPickerPaneId
    ? findPane(activeTab.root, terminalPickerPaneId)
    : null
  const terminalPickerConnectingProfile = terminalPickerConnectingId
    ? terminalProfiles.find(profile => profile.profileId === terminalPickerConnectingId) ?? null
    : null
  const terminalPickerConnectingEndpoint = terminalPickerConnectingProfile
    ? endpointById(terminalPickerConnectingProfile.endpointId)
    : null
  const terminalPickerResults = useMemo(() => rankTerminalProfiles(
    terminalProfiles,
    profile => endpointById(profile.endpointId),
    terminalQuery,
  ), [terminalProfiles, terminalQuery])
  const filteredTerminalProfiles = useMemo(() => terminalPickerResults.map(result => result.profile), [terminalPickerResults])

  const rememberTerminalActivity = useCallback((pane: PaneLeaf) => {
    const key = remotePaneKey(pane)
    setTerminalActivity(current => current[key]
      ? current
      : { ...current, [key]: seedTerminalActivity(pane) })
  }, [])

  const handleTerminalOutput = useCallback((pane: PaneLeaf, alert: TerminalActivityAlert) => {
    setTerminalActivity(current => ({
      ...current,
      [remotePaneKey(pane)]: {
        lastOutputAt: Date.now(),
        alert,
      },
    }))
  }, [])

  const updateActiveTab = useCallback((updater: (tab: PrototypeTab) => PrototypeTab) => {
    setTabs(current => current.map(tab => tab.id === activeTabId ? updater(tab) : tab))
  }, [activeTabId])

  const focusPane = useCallback((paneId: string) => {
    updateActiveTab(tab => ({ ...tab, activePaneId: paneId }))
    requestAnimationFrame(() => terminalsRef.current.get(paneId)?.focus())
  }, [updateActiveTab])

  const openMonitoredTerminal = useCallback((terminal: MonitoredTerminal) => {
    const location = findPaneLocation(tabs, terminal.pane.id)
    if (!location) return
    const changingTab = location.tab.id !== activeTabId
    setTabs(current => current.map(tab => tab.id === location.tab.id
      ? { ...tab, activePaneId: location.pane.id, maximizedPaneId: null }
      : tab))
    setActiveTabId(location.tab.id)
    if (changingTab) {
      setBroadcast(false)
      setBroadcastTargetKeys(new Set())
      setBroadcastDraftKeys(new Set())
    }
    setBroadcastTargetsOpen(false)
    setContextMenu(null)
    setMainMenuOpen(false)
    setFilesOpen(false)
    setTopologyOpen(false)
    setNotice(`Opened ${location.pane.terminalTitle}`)
    requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(location.pane.id)?.focus()))
  }, [activeTabId, tabs])

  const toggleFollowedTerminal = useCallback((pane: PaneLeaf) => {
    const key = remotePaneKey(pane)
    setFollowedTerminalKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveFollowedTerminalKeys(next)
      return next
    })
    setNotice(followedTerminalKeys.has(key) ? `Stopped watching ${pane.terminalTitle}` : `Watching ${pane.terminalTitle}`)
  }, [followedTerminalKeys])

  const openTerminalPicker = useCallback((paneId: string) => {
    terminalPickerRequestRef.current += 1
    if (terminalPickerTimerRef.current !== null) window.clearTimeout(terminalPickerTimerRef.current)
    terminalPickerTimerRef.current = null
    setTerminalPickerPaneId(paneId)
    setTerminalQuery('')
    setTerminalPickerIndex(0)
    setTerminalPickerConnectingId(null)
    setTerminalPickerError(null)
    setTerminalPickerCreating(false)
    setTerminalPickerCreateError('')
    setContextMenu(null)
    setMainMenuOpen(false)
    setBroadcastTargetsOpen(false)
    setTopologyOpen(false)
    setFilesOpen(false)
  }, [])

  const closeTerminalPicker = useCallback(() => {
    const paneId = terminalPickerPaneId
    terminalPickerRequestRef.current += 1
    if (terminalPickerTimerRef.current !== null) window.clearTimeout(terminalPickerTimerRef.current)
    terminalPickerTimerRef.current = null
    setTerminalPickerPaneId(null)
    setTerminalQuery('')
    setTerminalPickerConnectingId(null)
    setTerminalPickerError(null)
    setTerminalPickerCreating(false)
    setTerminalPickerCreateError('')
    const pending = pendingTabRef.current
    if (pending && pending.paneId === paneId) {
      pendingTabRef.current = null
      setTabs(current => current.filter(tab => tab.id !== pending.tabId))
      setActiveTabId(pending.previousTabId)
      requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(pending.previousPaneId)?.focus()))
      return
    }
    if (paneId) requestAnimationFrame(() => terminalsRef.current.get(paneId)?.focus())
  }, [terminalPickerPaneId])

  const selectTerminal = useCallback((profile: TerminalProfile, paneIdOverride?: string) => {
    const paneId = paneIdOverride ?? terminalPickerPaneId
    if (!paneId || terminalPickerConnectingId) return
    const endpoint = endpointById(profile.endpointId)
    setTerminalPickerError(null)

    const existing = findTerminalLocation(tabs, profile, paneId)
    if (existing) {
      const pending = pendingTabRef.current
      if (pending?.paneId === paneId) pendingTabRef.current = null
      setTabs(current => current
        .filter(tab => tab.id !== (pending?.paneId === paneId ? pending.tabId : ''))
        .map(tab => tab.id === existing.tab.id ? { ...tab, activePaneId: existing.pane.id } : tab))
      setActiveTabId(existing.tab.id)
      setBroadcast(false)
      setBroadcastTargetKeys(new Set())
      setBroadcastDraftKeys(new Set())
      setTerminalPickerPaneId(null)
      setTerminalQuery('')
      setTerminalPickerConnectingId(null)
      setTerminalPickerError(null)
      setTerminalPickerCreating(false)
      setTerminalPickerCreateError('')
      setTopologyOpen(false)
      setNotice(`${profile.terminalTitle} is already open`)
      requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(existing.pane.id)?.focus()))
      return
    }

    const commitSelection = () => {
      const replacement = paneFromProfile(profile, paneId)
      const previousPane = panes.find(pane => pane.id === paneId)
      if (previousPane) {
        const previousKey = remotePaneKey(previousPane)
        if (broadcastTargetKeys.has(previousKey)) {
          const nextTargets = new Set(broadcastTargetKeys)
          const previousStillVisible = panes.some(pane => pane.id !== paneId && !pane.detached && remotePaneKey(pane) === previousKey)
          if (!previousStillVisible) nextTargets.delete(previousKey)
          nextTargets.add(remotePaneKey(replacement))
          if (nextTargets.size < 2) {
            setBroadcast(false)
            setBroadcastTargetKeys(new Set())
          } else {
            setBroadcastTargetKeys(nextTargets)
          }
        }
      }
      rememberTerminalActivity(replacement)
      updateActiveTab(tab => ({
        ...tab,
        root: replacePaneBinding(tab.root, paneId, replacement),
        activePaneId: paneId,
        title: previousPane?.unbound ? profile.terminalTitle : tab.title,
      }))
      if (pendingTabRef.current?.paneId === paneId) pendingTabRef.current = null
      setTerminalPickerPaneId(null)
      setTerminalQuery('')
      setTerminalPickerConnectingId(null)
      setTerminalPickerError(null)
      setTerminalPickerCreating(false)
      setTerminalPickerCreateError('')
      setNotice(`Attached ${profile.terminalTitle} on ${endpoint.label}`)
      requestAnimationFrame(() => terminalsRef.current.get(paneId)?.focus())
    }

    if (connectedEndpointIds.has(endpoint.id)) {
      commitSelection()
      return
    }

    const requestId = ++terminalPickerRequestRef.current
    setTerminalPickerConnectingId(profile.profileId)
    terminalPickerTimerRef.current = window.setTimeout(() => {
      terminalPickerTimerRef.current = null
      if (requestId !== terminalPickerRequestRef.current) return
      const attempt = (endpointConnectionAttemptsRef.current.get(endpoint.id) ?? 0) + 1
      endpointConnectionAttemptsRef.current.set(endpoint.id, attempt)
      if (endpoint.failFirstAttempt && attempt === 1) {
        setTerminalPickerConnectingId(null)
        setTerminalPickerError({
          profileId: profile.profileId,
          message: `${endpoint.label} timed out before tmux topology loaded`,
        })
        return
      }
      setConnectedEndpointIds(current => new Set(current).add(endpoint.id))
      commitSelection()
    }, 900)
  }, [broadcastTargetKeys, connectedEndpointIds, panes, rememberTerminalActivity, tabs, terminalPickerConnectingId, terminalPickerPaneId, updateActiveTab])

  const createTerminalFromPicker = useCallback(() => {
    const paneId = terminalPickerPaneId
    if (!paneId || terminalPickerCreating) return
    const targetPane = panes.find(pane => pane.id === paneId)
    if (!targetPane) return
    setTerminalPickerCreating(true)
    setTerminalPickerCreateError('')
    try {
      const paneNumber = terminalProfiles
        .filter(profile => profile.endpointId === targetPane.endpointId)
        .reduce((highest, profile) => Math.max(highest, Number(profile.remotePaneId.replace('%', '')) || 0), 0) + 1
      const terminalNumber = nextManagedTerminalNumber(terminalProfiles)
      const profile: TerminalProfile = {
        profileId: `prototype-created-${++topologySequenceRef.current}`,
        endpointId: targetPane.endpointId,
        tmuxInstanceId: targetPane.tmuxInstanceId,
        terminalTitle: `terminal-${terminalNumber}`,
        path: targetPane.path,
        session: DESKTOP_MANAGED_TMUX_SESSION,
        sessionId: 'prototype-session-tgent',
        windowName: `terminal-${terminalNumber}`,
        remotePaneId: `%${paneNumber}`,
      }
      setTerminalProfiles(current => [...current, profile])
      setConnectedEndpointIds(current => new Set(current).add(profile.endpointId))
      selectTerminal(profile, paneId)
    } catch (error) {
      setTerminalPickerCreating(false)
      setTerminalPickerCreateError(error instanceof Error ? error.message : String(error))
    }
  }, [panes, selectTerminal, terminalPickerCreating, terminalPickerPaneId, terminalProfiles])

  const moveTerminalPickerSelection = useCallback((step: number) => {
    if (!filteredTerminalProfiles.length) return
    setTerminalPickerIndex(current => (current + step + filteredTerminalProfiles.length) % filteredTerminalProfiles.length)
  }, [filteredTerminalProfiles])

  useEffect(() => {
    if (!terminalPickerPaneId) return
    const profile = filteredTerminalProfiles[terminalPickerIndex]
    if (!profile) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`terminal-picker-option-${profile.profileId}`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [filteredTerminalProfiles, terminalPickerIndex, terminalPickerPaneId])

  const handleSplit = useCallback((paneId: string, direction: SplitDirection) => {
    const nextPane = createPane()
    rememberTerminalActivity(nextPane)
    updateActiveTab(tab => ({
      ...tab,
      root: splitPane(tab.root, paneId, direction, nextPane),
      activePaneId: nextPane.id,
      maximizedPaneId: null,
    }))
    requestAnimationFrame(() => terminalsRef.current.get(nextPane.id)?.focus())
  }, [rememberTerminalActivity, updateActiveTab])

  const handleClosePane = useCallback((paneId: string) => {
    if (panes.length === 1) {
      terminalsRef.current.delete(paneId)
      if (tabs.length > 1) {
        const closingTabId = activeTab.id
        setTabs(current => {
          const index = current.findIndex(tab => tab.id === closingTabId)
          const nextTabs = current.filter(tab => tab.id !== closingTabId)
          setActiveTabId(nextTabs[Math.max(0, index - 1)]?.id ?? nextTabs[0].id)
          return nextTabs
        })
        setBroadcast(false)
        setBroadcastTargetKeys(new Set())
        setBroadcastDraftKeys(new Set())
        setBroadcastTargetsOpen(false)
        setContextMenu(null)
        return
      }
      const replacement = unboundPaneFrom(panes[0], paneId)
      updateActiveTab(tab => ({
        ...tab,
        title: 'New tab',
        root: replacement,
        activePaneId: paneId,
        maximizedPaneId: null,
      }))
      setBroadcast(false)
      setBroadcastTargetKeys(new Set())
      setBroadcastDraftKeys(new Set())
      setBroadcastTargetsOpen(false)
      setContextMenu(null)
      requestAnimationFrame(() => openTerminalPicker(paneId))
      return
    }
    preparePaneRemovalLayout(tabs, terminalsRef.current, paneId)
    updateActiveTab(tab => {
      const existingPanes = listPanes(tab.root)
      if (existingPanes.length === 1) return tab
      const nextRoot = removePane(tab.root, paneId)
      if (!nextRoot) return tab
      const remaining = listPanes(nextRoot)
      const nextActive = remaining.some(pane => pane.id === tab.activePaneId)
        ? tab.activePaneId
        : remaining[0].id
      requestAnimationFrame(() => terminalsRef.current.get(nextActive)?.focus())
      return {
        ...tab,
        root: nextRoot,
        activePaneId: nextActive,
        maximizedPaneId: tab.maximizedPaneId === paneId ? null : tab.maximizedPaneId,
      }
    })
    const closingPane = panes.find(pane => pane.id === paneId)
    if (closingPane) {
      const closingKey = remotePaneKey(closingPane)
      const stillVisible = panes.some(pane => pane.id !== paneId && !pane.detached && remotePaneKey(pane) === closingKey)
      if (!stillVisible && broadcastTargetKeys.has(closingKey)) {
        const nextTargets = new Set(broadcastTargetKeys)
        nextTargets.delete(closingKey)
        if (nextTargets.size < 2) {
          setBroadcast(false)
          setBroadcastTargetKeys(new Set())
        } else {
          setBroadcastTargetKeys(nextTargets)
        }
      }
    }
    terminalsRef.current.delete(paneId)
    setContextMenu(null)
  }, [activeTab.id, broadcastTargetKeys, openTerminalPicker, panes, tabs.length, updateActiveTab])

  const toggleMaximize = useCallback((paneId: string) => {
    updateActiveTab(tab => ({
      ...tab,
      activePaneId: paneId,
      maximizedPaneId: tab.maximizedPaneId === paneId ? null : paneId,
    }))
  }, [updateActiveTab])

  const changeRatio = useCallback((splitId: string, ratio: number) => {
    updateActiveTab(tab => ({ ...tab, root: updateSplitRatio(tab.root, splitId, ratio) }))
  }, [updateActiveTab])

  const registerTerminal = useCallback((paneId: string, handle: MockTerminalHandle | null) => {
    if (handle) terminalsRef.current.set(paneId, handle)
    else terminalsRef.current.delete(paneId)
  }, [])

  const openBroadcastTargets = useCallback(() => {
    const availableKeys = new Set(broadcastCandidates.map(candidate => candidate.key))
    const currentKeys = new Set([...broadcastTargetKeys].filter(key => availableKeys.has(key)))
    setBroadcastDraftKeys(broadcast && currentKeys.size ? currentKeys : availableKeys)
    setBroadcastTargetsOpen(true)
    setContextMenu(null)
    setMainMenuOpen(false)
    setTopologyOpen(false)
    setFilesOpen(false)
  }, [broadcast, broadcastCandidates, broadcastTargetKeys])

  const toggleTopologyNode = useCallback((key: string) => {
    setTopologyExpandedKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const openTopology = useCallback(() => {
    setTopologyOpen(true)
    setContextMenu(null)
    setMainMenuOpen(false)
    setBroadcastTargetsOpen(false)
    setFilesOpen(false)
  }, [])

  const selectTopologyTerminal = useCallback((profile: TerminalProfile) => {
    const paneId = activeTab.activePaneId
    const endpoint = endpointById(profile.endpointId)
    setTopologyOpen(false)
    if (!connectedEndpointIds.has(endpoint.id)) {
      openTerminalPicker(paneId)
      setTerminalQuery(profile.terminalTitle)
      setTerminalPickerIndex(0)
    }
    selectTerminal(profile, paneId)
  }, [activeTab.activePaneId, connectedEndpointIds, openTerminalPicker, selectTerminal])

  const placeTopologyTerminal = useCallback((profile: TerminalProfile, paneId: string, intent: PaneDropIntent) => {
    const endpoint = endpointById(profile.endpointId)
    setTopologyOpen(false)
    const existing = findTerminalLocation(tabs, profile)
    if (existing) {
      setTabs(current => current.map(tab => tab.id === existing.tab.id
        ? { ...tab, activePaneId: existing.pane.id, maximizedPaneId: null }
        : tab))
      setActiveTabId(existing.tab.id)
      setBroadcast(false)
      setBroadcastTargetKeys(new Set())
      setBroadcastDraftKeys(new Set())
      setNotice(`${profile.terminalTitle} is already open`)
      requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(existing.pane.id)?.focus()))
      return
    }
    if (intent === 'replace') {
      selectTerminal(profile, paneId)
      return
    }
    if (!connectedEndpointIds.has(endpoint.id)) {
      openTerminalPicker(paneId)
      setTerminalQuery(profile.terminalTitle)
      setTerminalPickerIndex(0)
      selectTerminal(profile, paneId)
      return
    }

    const sequence = paneSequence++
    const nextPane = paneFromProfile(profile, `prototype-pane-${sequence + 1}`)
    rememberTerminalActivity(nextPane)
    const direction: SplitDirection = intent === 'left' || intent === 'right' ? 'vertical' : 'horizontal'
    const placement = intent === 'left' || intent === 'top' ? 'before' : 'after'
    updateActiveTab(tab => ({
      ...tab,
      root: splitPane(tab.root, paneId, direction, nextPane, placement),
      activePaneId: nextPane.id,
      maximizedPaneId: null,
    }))
    setNotice(`${paneDropLabels[intent]} · ${profile.terminalTitle}`)
    requestAnimationFrame(() => terminalsRef.current.get(nextPane.id)?.focus())
  }, [connectedEndpointIds, openTerminalPicker, rememberTerminalActivity, selectTerminal, tabs, updateActiveTab])

  const readDropPreview = useCallback((paneId: string, intent: PaneDropIntent): PaneDropPreview | null => {
    const element = workspaceRef.current?.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const horizontalSplit = intent === 'left' || intent === 'right'
    const verticalSplit = intent === 'top' || intent === 'bottom'
    const pixelWidth = Math.max(120, Math.round(rect.width * (horizontalSplit ? 0.5 : 1)))
    const pixelHeight = Math.max(90, Math.round(rect.height * (verticalSplit ? 0.5 : 1)))
    return {
      paneId,
      intent,
      pixelWidth,
      pixelHeight,
      columns: Math.max(20, Math.floor((pixelWidth - 24) / 8.2)),
      rows: Math.max(4, Math.floor((pixelHeight - 43) / 16)),
    }
  }, [])

  const handleTopologyDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as TopologyDragData | undefined
    if (data?.type !== 'topology-pane') return
    setDraggedProfile(data.profile)
    setDropPreview(null)
    setContextMenu(null)
    setMainMenuOpen(false)
  }, [])

  const handleTopologyDragOver = useCallback((event: DragOverEvent) => {
    const data = event.over?.data.current as PaneDropData | undefined
    if (data?.type !== 'pane-drop') {
      setDropPreview(null)
      return
    }
    setDropPreview(readDropPreview(data.paneId, data.intent))
  }, [readDropPreview])

  const resetTopologyDrag = useCallback(() => {
    setDraggedProfile(null)
    setDropPreview(null)
  }, [])

  const handleTopologyDragEnd = useCallback((event: DragEndEvent) => {
    const activeData = event.active.data.current as TopologyDragData | undefined
    const overData = event.over?.data.current as PaneDropData | undefined
    if (activeData?.type === 'topology-pane' && overData?.type === 'pane-drop') {
      placeTopologyTerminal(activeData.profile, overData.paneId, overData.intent)
    }
    resetTopologyDrag()
  }, [placeTopologyTerminal, resetTopologyDrag])

  const handleTopologyAction = useCallback((action: TopologyAction, node: TopologyBrowserNode) => {
    if (action === 'open' && node.profile) {
      placeTopologyTerminal(node.profile, activeTab.activePaneId, 'replace')
      return
    }
    if (action === 'split-right' && node.profile) {
      placeTopologyTerminal(node.profile, activeTab.activePaneId, 'right')
      return
    }
    if (action === 'split-below' && node.profile) {
      placeTopologyTerminal(node.profile, activeTab.activePaneId, 'bottom')
      return
    }
    if (action === 'refresh') {
      setNotice(`Refreshed ${node.label}`)
      return
    }
    if (action === 'edit-connection') {
      setNotice(`Connection editor · ${node.label}`)
      return
    }
    if (action === 'create') {
      setTopologyMutation({ mode: 'create', node, value: '' })
      return
    }
    if (action === 'rename') {
      setTopologyMutation({ mode: 'rename', node, value: node.label })
      return
    }
    setTopologyMutation({ mode: 'delete', node, value: '' })
  }, [activeTab.activePaneId, placeTopologyTerminal])

  const commitTopologyMutation = useCallback(() => {
    if (!topologyMutation) return
    const { mode, node } = topologyMutation
    const value = topologyMutation.value.trim()
    if (mode !== 'delete' && !value) return

    if (mode === 'create') {
      const session = node.kind === 'endpoint' ? value : node.session
      const windowName = node.kind === 'session' ? value : node.kind === 'window' ? node.windowName : 'shell'
      if (!session || !windowName) return
      const paneNumber = terminalProfiles
        .filter(profile => profile.endpointId === node.endpointId)
        .reduce((highest, profile) => Math.max(highest, Number(profile.remotePaneId.replace('%', '')) || 0), 0) + 1
      const profile: TerminalProfile = {
        profileId: `prototype-topology-${++topologySequenceRef.current}`,
        endpointId: node.endpointId,
        terminalTitle: node.kind === 'window' ? value : `${windowName} shell`,
        path: '~',
        session,
        windowName,
        remotePaneId: `%${paneNumber}`,
      }
      setTerminalProfiles(current => [...current, profile])
      setTopologyExpandedKeys(current => {
        const next = new Set(current)
        next.add(`endpoint:${node.endpointId}`)
        next.add(`endpoint:${node.endpointId}:session:${session}`)
        next.add(`endpoint:${node.endpointId}:session:${session}:window:${windowName}`)
        return next
      })
      setNotice(`Created ${node.kind === 'endpoint' ? 'session' : node.kind === 'session' ? 'window' : 'pane'} ${value}`)
    } else if (mode === 'rename') {
      setTerminalProfiles(current => current.map(profile => {
        if (node.kind === 'session' && profile.endpointId === node.endpointId && profile.session === node.session) {
          return { ...profile, session: value }
        }
        if (node.kind === 'window' && profile.endpointId === node.endpointId && profile.session === node.session && profile.windowName === node.windowName) {
          return { ...profile, windowName: value }
        }
        if (node.kind === 'pane' && profile.profileId === node.profile?.profileId) {
          return { ...profile, terminalTitle: value }
        }
        return profile
      }))
      setTabs(current => current.map(tab => ({
        ...tab,
        root: mapLayoutPanes(tab.root, pane => {
          if (node.kind === 'session' && pane.endpointId === node.endpointId && pane.session === node.session) return { ...pane, session: value }
          if (node.kind === 'window' && pane.endpointId === node.endpointId && pane.session === node.session && pane.windowName === node.windowName) return { ...pane, windowName: value }
          if (node.kind === 'pane' && node.profile && remotePaneKey(pane) === terminalProfileKey(node.profile)) return { ...pane, terminalTitle: value }
          return pane
        }),
      })))
      setNotice(`Renamed ${node.kind} to ${value}`)
    } else {
      const removedProfiles = terminalProfiles.filter(profile => {
        if (node.kind === 'endpoint') return profile.endpointId === node.endpointId
        if (node.kind === 'session') return profile.endpointId === node.endpointId && profile.session === node.session
        if (node.kind === 'window') return profile.endpointId === node.endpointId && profile.session === node.session && profile.windowName === node.windowName
        return profile.profileId === node.profile?.profileId
      })
      const removedKeys = new Set(removedProfiles.map(terminalProfileKey))
      setTerminalProfiles(current => current.filter(profile => !removedProfiles.some(removed => removed.profileId === profile.profileId)))
      if (node.kind === 'endpoint') setHiddenEndpointIds(current => new Set(current).add(node.endpointId))
      setTabs(current => current.map(tab => ({
        ...tab,
        root: mapLayoutPanes(tab.root, pane => removedKeys.has(remotePaneKey(pane)) ? { ...pane, detached: true } : pane),
      })))
      setNotice(node.kind === 'endpoint' ? `Removed ${node.label}` : `Killed ${node.kind} ${node.label}`)
    }
    setTopologyMutation(null)
  }, [terminalProfiles, topologyMutation])

  const toggleBroadcastDraft = useCallback((key: string) => {
    setBroadcastDraftKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const applyBroadcastTargets = useCallback(() => {
    if (broadcastDraftKeys.size < 2) return
    setBroadcastTargetKeys(new Set(broadcastDraftKeys))
    setBroadcast(true)
    setBroadcastTargetsOpen(false)
    setNotice(`Broadcasting to ${broadcastDraftKeys.size} terminals`)
  }, [broadcastDraftKeys])

  const stopBroadcast = useCallback(() => {
    setBroadcast(false)
    setBroadcastTargetKeys(new Set())
    setBroadcastDraftKeys(new Set())
    setBroadcastTargetsOpen(false)
    setNotice('Input broadcast stopped')
  }, [])

  const handleRemotePaneExit = useCallback((paneId: string) => {
    const pane = panes.find(candidate => candidate.id === paneId)
    if (!pane || pane.detached) return
    setTerminalActivity(current => ({
      ...current,
      [remotePaneKey(pane)]: {
        lastOutputAt: current[remotePaneKey(pane)]?.lastOutputAt ?? Date.now(),
        alert: 'exited',
      },
    }))
    updateActiveTab(tab => ({
      ...tab,
      root: replacePaneBinding(tab.root, paneId, { ...pane, detached: true }),
      activePaneId: paneId,
    }))
    terminalsRef.current.delete(paneId)
    if (activeTab.activePaneId === paneId) setFilesOpen(false)

    const key = remotePaneKey(pane)
    const stillVisible = panes.some(candidate => candidate.id !== paneId && !candidate.detached && remotePaneKey(candidate) === key)
    if (!stillVisible && broadcastTargetKeys.has(key)) {
      const nextTargets = new Set(broadcastTargetKeys)
      nextTargets.delete(key)
      if (nextTargets.size < 2) {
        setBroadcast(false)
        setBroadcastTargetKeys(new Set())
      } else {
        setBroadcastTargetKeys(nextTargets)
      }
    }
  }, [activeTab.activePaneId, broadcastTargetKeys, panes, updateActiveTab])

  const handleTerminalInput = useCallback((sourcePaneId: string, data: string) => {
    if (!broadcast) return
    const sourcePane = panes.find(pane => pane.id === sourcePaneId)
    if (!sourcePane || sourcePane.detached) return
    const sourceKey = remotePaneKey(sourcePane)
    if (!broadcastTargetKeys.has(sourceKey)) return
    const deliveredRemotePanes = new Set([sourceKey])
    for (const [paneId, terminal] of terminalsRef.current.entries()) {
      if (paneId === sourcePaneId) continue
      const pane = panes.find(candidate => candidate.id === paneId)
      if (!pane || pane.detached) continue
      const remoteKey = remotePaneKey(pane)
      if (!broadcastTargetKeys.has(remoteKey)) continue
      if (deliveredRemotePanes.has(remoteKey)) continue
      deliveredRemotePanes.add(remoteKey)
      terminal.receiveInput(data)
    }
  }, [broadcast, broadcastTargetKeys, panes])

  const focusByDirection = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const workspace = workspaceRef.current
    if (!workspace) return
    const activeElement = workspace.querySelector<HTMLElement>(`[data-pane-id="${activeTab.activePaneId}"]`)
    if (!activeElement) return
    const activeRect = activeElement.getBoundingClientRect()
    const activeCenter = { x: activeRect.left + activeRect.width / 2, y: activeRect.top + activeRect.height / 2 }
    const candidates = panes
      .filter(pane => pane.id !== activeTab.activePaneId)
      .map(pane => {
        const element = workspace.querySelector<HTMLElement>(`[data-pane-id="${pane.id}"]`)
        if (!element) return null
        const rect = element.getBoundingClientRect()
        const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        const primary = direction === 'left' ? activeCenter.x - center.x
          : direction === 'right' ? center.x - activeCenter.x
            : direction === 'up' ? activeCenter.y - center.y
              : center.y - activeCenter.y
        if (primary <= 1) return null
        const cross = direction === 'left' || direction === 'right'
          ? Math.abs(center.y - activeCenter.y)
          : Math.abs(center.x - activeCenter.x)
        return { id: pane.id, score: primary + cross * 0.65 }
      })
      .filter((candidate): candidate is { id: string; score: number } => candidate !== null)
      .sort((a, b) => a.score - b.score)
    if (candidates[0]) focusPane(candidates[0].id)
  }, [activeTab.activePaneId, focusPane, panes])

  const cyclePane = useCallback((step: number) => {
    const index = panes.findIndex(pane => pane.id === activeTab.activePaneId)
    const next = panes[(index + step + panes.length) % panes.length]
    if (next) focusPane(next.id)
  }, [activeTab.activePaneId, focusPane, panes])

  const activateTab = useCallback((tabId: string) => {
    if (tabId === activeTabId) return
    setBroadcast(false)
    setBroadcastTargetKeys(new Set())
    setBroadcastDraftKeys(new Set())
    setBroadcastTargetsOpen(false)
    setTopologyOpen(false)
    setActiveTabId(tabId)
  }, [activeTabId])

  const addTab = useCallback(() => {
    const pane = unboundPaneFrom(activePane, `prototype-pane-${++paneSequence}`)
    const tab: PrototypeTab = {
      id: `prototype-tab-${++tabSequence}`,
      title: 'New tab',
      root: pane,
      activePaneId: pane.id,
      maximizedPaneId: null,
    }
    pendingTabRef.current = {
      tabId: tab.id,
      paneId: pane.id,
      previousTabId: activeTabId,
      previousPaneId: activeTab.activePaneId,
    }
    setTabs(current => [...current, tab])
    setBroadcast(false)
    setBroadcastTargetKeys(new Set())
    setBroadcastDraftKeys(new Set())
    setBroadcastTargetsOpen(false)
    setTopologyOpen(false)
    setActiveTabId(tab.id)
    openTerminalPicker(pane.id)
  }, [activePane, activeTab.activePaneId, activeTabId, openTerminalPicker])

  const closeTab = useCallback((tabId: string) => {
    setTabs(current => {
      if (current.length === 1) return current
      const index = current.findIndex(tab => tab.id === tabId)
      const nextTabs = current.filter(tab => tab.id !== tabId)
      if (tabId === activeTabId) {
        const next = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0]
        setBroadcast(false)
        setBroadcastTargetKeys(new Set())
        setBroadcastDraftKeys(new Set())
        setBroadcastTargetsOpen(false)
        setTopologyOpen(false)
        setActiveTabId(next.id)
      }
      return nextTabs
    })
  }, [activeTabId])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 1400)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!terminalPickerPaneId) return
    const frame = requestAnimationFrame(() => terminalPickerInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [terminalPickerPaneId])

  useEffect(() => () => {
    if (terminalPickerTimerRef.current !== null) window.clearTimeout(terminalPickerTimerRef.current)
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) return
      if ((broadcastTargetsOpen || contextMenu || mainMenuOpen || filesOpen || terminalPickerPaneId || topologyOpen || topologyMutation) && event.key === 'Escape') {
        setBroadcastTargetsOpen(false)
        setContextMenu(null)
        setMainMenuOpen(false)
        setFilesOpen(false)
        setTopologyOpen(false)
        setTopologyMutation(null)
        closeTerminalPicker()
        return
      }
      if (terminalPickerPaneId || broadcastTargetsOpen || topologyOpen || topologyMutation) return
      if (!event.metaKey) return
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        openTerminalPicker(activeTab.activePaneId)
      } else if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        handleSplit(activeTab.activePaneId, event.shiftKey ? 'horizontal' : 'vertical')
      } else if (event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        toggleMaximize(activeTab.activePaneId)
      } else if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault()
        focusByDirection(event.key.replace('Arrow', '').toLowerCase() as 'left' | 'right' | 'up' | 'down')
      } else if (event.key === '[') {
        event.preventDefault()
        cyclePane(-1)
      } else if (event.key === ']') {
        event.preventDefault()
        cyclePane(1)
      } else if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        handleClosePane(activeTab.activePaneId)
      } else if (event.key.toLowerCase() === 't') {
        event.preventDefault()
        addTab()
      } else if (event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        setFilesOpen(value => !value)
      } else if (/^[1-9]$/.test(event.key)) {
        const tab = tabs[Number(event.key) - 1]
        if (tab) {
          event.preventDefault()
          activateTab(tab.id)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activateTab, activeTab.activePaneId, addTab, broadcastTargetsOpen, closeTerminalPicker, contextMenu, cyclePane, filesOpen, focusByDirection, handleClosePane, handleSplit, mainMenuOpen, openTerminalPicker, settingsOpen, tabs, terminalPickerPaneId, toggleMaximize, topologyMutation, topologyOpen])

  return (
    <DndContext
      sensors={dragSensors}
      collisionDetection={pointerWithin}
      onDragStart={handleTopologyDragStart}
      onDragOver={handleTopologyDragOver}
      onDragEnd={handleTopologyDragEnd}
      onDragCancel={resetTopologyDrag}
    >
      <main
        className="desktop-prototype-shell"
        onPointerDown={() => {
          setBroadcastTargetsOpen(false)
          setContextMenu(null)
          setMainMenuOpen(false)
          setTopologyOpen(false)
        }}
      >
      <header className="desktop-window-bar">
        <div className="desktop-traffic-lights" aria-hidden="true">
          <span className="is-close" />
          <span className="is-minimize" />
          <span className="is-zoom" />
        </div>
        <div className="desktop-tabs" role="tablist" aria-label="Terminal tabs">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              role="tab"
              tabIndex={0}
              aria-selected={tab.id === activeTabId}
              className={`desktop-tab ${tab.id === activeTabId ? 'is-active' : ''}`}
              onClick={() => activateTab(tab.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') activateTab(tab.id)
              }}
              title={`Tab ${index + 1}`}
            >
              <TabActivityDots panes={listPanes(tab.root)} activityRecords={terminalActivity} />
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <span
                  className="desktop-tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`Close ${tab.title}`}
                  onClick={event => { event.stopPropagation(); closeTab(tab.id) }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') closeTab(tab.id)
                  }}
                >
                  <X size={12} />
                </span>
              )}
            </div>
          ))}
          <button type="button" className="desktop-new-tab" onClick={addTab} aria-label="New terminal tab" title="New tab (Command-T)">
            <Plus size={15} />
          </button>
        </div>
        <TerminalWatchStrip
          terminals={monitoredTerminals}
          activeTabId={activeTabId}
          activePaneId={activeTab.activePaneId}
          onSelect={openMonitoredTerminal}
        />
        <div className="desktop-window-tools">
          <button
            type="button"
            className={topologyOpen ? 'is-active' : ''}
            onClick={event => {
              event.stopPropagation()
              if (topologyOpen) setTopologyOpen(false)
              else openTopology()
            }}
            aria-pressed={topologyOpen}
            aria-label="Open tmux topology"
            title="Tmux topology"
          >
            <Network size={15} />
          </button>
          <button
            type="button"
            className={filesOpen ? 'is-active' : ''}
            onClick={event => {
              event.stopPropagation()
              setFilesOpen(value => !value)
              setMainMenuOpen(false)
              setBroadcastTargetsOpen(false)
              setTopologyOpen(false)
            }}
            aria-pressed={filesOpen}
            aria-label="Open file browser"
            title="Files (Command-Shift-E)"
          >
            <FolderOpen size={15} />
          </button>
          <button
            type="button"
            className={broadcast ? 'is-broadcasting' : ''}
            onClick={event => {
              event.stopPropagation()
              if (broadcastTargetsOpen) setBroadcastTargetsOpen(false)
              else openBroadcastTargets()
            }}
            aria-pressed={broadcast}
            aria-label={broadcast ? 'Adjust broadcast targets' : 'Choose broadcast targets'}
            aria-haspopup="dialog"
            aria-expanded={broadcastTargetsOpen}
            title={broadcast ? 'Adjust broadcast targets' : 'Choose broadcast targets'}
          >
            <Radio size={15} />
            {broadcast && <span className="desktop-broadcast-count">{broadcastTargetKeys.size}</span>}
          </button>
          <button
            type="button"
            className={mainMenuOpen ? 'is-active' : ''}
            aria-label="More terminal actions"
            aria-haspopup="menu"
            aria-expanded={mainMenuOpen}
            title="More actions"
            onClick={event => {
              event.stopPropagation()
              setMainMenuOpen(value => !value)
              setContextMenu(null)
              setBroadcastTargetsOpen(false)
              setTopologyOpen(false)
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>

      {topologyOpen && (
        <TopologyBrowser
          targetPane={activePane}
          nodes={topologyBrowserNodes}
          paneCount={terminalProfiles.length}
          expandedKeys={topologyExpandedKeys}
          connectedEndpointIds={connectedEndpointIds}
          checkingEndpointIds={new Set()}
          onToggle={toggleTopologyNode}
          onSelect={selectTopologyTerminal}
          onAction={handleTopologyAction}
          onClose={() => setTopologyOpen(false)}
        />
      )}

      {broadcastTargetsOpen && (
        <BroadcastTargetPicker
          candidates={broadcastCandidates}
          selectedKeys={broadcastDraftKeys}
          active={broadcast}
          onToggle={toggleBroadcastDraft}
          onApply={applyBroadcastTargets}
          onStop={stopBroadcast}
          onClose={() => setBroadcastTargetsOpen(false)}
        />
      )}

      <section
        ref={workspaceRef}
        className={`desktop-terminal-workspace ${activeTab.maximizedPaneId ? 'is-maximized' : ''} ${broadcast ? 'is-broadcasting' : ''}`}
      >
        {tabs.map(tab => {
          const isActiveTab = tab.id === activeTabId
          const tabRoot = tab.maximizedPaneId
            ? findPane(tab.root, tab.maximizedPaneId) ?? tab.root
            : tab.root
          return (
            <div
              key={tab.id}
              className={`desktop-terminal-tab-surface ${isActiveTab ? 'is-active' : ''}`}
              data-tab-id={tab.id}
              data-terminal-residency="warm"
              aria-hidden={!isActiveTab}
            >
              <PaneTree
                node={tabRoot}
                activePaneId={isActiveTab ? tab.activePaneId : ''}
                visible={isActiveTab}
                maximizedPaneId={tab.maximizedPaneId}
                broadcastTargetKeys={broadcast ? broadcastTargetKeys : new Set<string>()}
                draggedProfile={isActiveTab ? draggedProfile : null}
                dropPreview={isActiveTab ? dropPreview : null}
                onActivate={focusPane}
                onInput={handleTerminalInput}
                onOutput={handleTerminalOutput}
                onRemoteExit={handleRemotePaneExit}
                onPasteClipboardImage={(_pane, image) => Promise.resolve(image.localPath)}
                onRebind={openTerminalPicker}
                onSplit={handleSplit}
                onToggleMaximize={toggleMaximize}
                onClose={handleClosePane}
                onRatioChange={changeRatio}
                onContextMenu={(event, paneId) => {
                  event.preventDefault()
                  event.stopPropagation()
                  focusPane(paneId)
                  setMainMenuOpen(false)
                  setContextMenu({ paneId, x: event.clientX, y: event.clientY })
                }}
                registerTerminal={registerTerminal}
                allowPrototypeTerminal
              />
            </div>
          )
        })}
      </section>

      {terminalPickerPaneId && (
        <div className="desktop-terminal-picker-layer" onPointerDown={closeTerminalPicker}>
          <div
            ref={terminalPickerRef}
            className="desktop-terminal-picker"
            role="dialog"
            aria-modal="true"
            aria-label="Terminal picker"
            aria-busy={Boolean(terminalPickerConnectingId) || terminalPickerCreating}
            onPointerDown={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key !== 'Tab') return
              const focusable = terminalPickerRef.current?.querySelectorAll<HTMLElement>('input, button:not([disabled])')
              if (!focusable?.length) return
              const first = focusable[0]
              const last = focusable[focusable.length - 1]
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
              }
            }}
          >
            <div className="desktop-terminal-picker-search">
              <Search size={16} aria-hidden="true" />
              <input
                ref={terminalPickerInputRef}
                value={terminalQuery}
                disabled={Boolean(terminalPickerConnectingId) || terminalPickerCreating}
                onChange={event => {
                  setTerminalQuery(event.target.value)
                  setTerminalPickerIndex(0)
                  setTerminalPickerError(null)
                  setTerminalPickerCreateError('')
                }}
                onKeyDown={event => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    moveTerminalPickerSelection(1)
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveTerminalPickerSelection(-1)
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    if (event.metaKey || event.ctrlKey) {
                      createTerminalFromPicker()
                      return
                    }
                    const profile = filteredTerminalProfiles[terminalPickerIndex]
                    if (profile) selectTerminal(profile)
                  }
                }}
                role="combobox"
                aria-label="Find a terminal"
                aria-controls="terminal-picker-results"
                aria-expanded="true"
                aria-activedescendant={filteredTerminalProfiles[terminalPickerIndex]
                  ? `terminal-picker-option-${filteredTerminalProfiles[terminalPickerIndex].profileId}`
                  : undefined}
                autoComplete="off"
                spellCheck={false}
                placeholder="Find a terminal"
              />
              <kbd>⌘P</kbd>
            </div>
            <div id="terminal-picker-results" className="desktop-terminal-picker-results" role="listbox" aria-label="Available terminals">
              {terminalPickerResults.map(({ profile, matches }, index) => {
                const endpoint = endpointById(profile.endpointId)
                const connected = connectedEndpointIds.has(endpoint.id)
                const connecting = terminalPickerConnectingId === profile.profileId
                const failed = terminalPickerError?.profileId === profile.profileId
                const current = terminalPickerTargetPane
                  ? remotePaneKey(terminalPickerTargetPane) === terminalProfileKey(profile)
                  : false
                return (
                  <button
                    id={`terminal-picker-option-${profile.profileId}`}
                    key={profile.profileId}
                    type="button"
                    role="option"
                    disabled={Boolean(terminalPickerConnectingId) || terminalPickerCreating}
                    aria-selected={index === terminalPickerIndex}
                    aria-label={`${profile.terminalTitle}, ${endpoint.label}, ${endpoint.host}, ${connecting ? 'connecting' : failed ? 'connection failed' : connected ? 'connected' : 'offline'}, ${profile.session}, ${profile.windowName}, ${profile.remotePaneId}`}
                    className={`${index === terminalPickerIndex ? 'is-selected' : ''} ${connecting ? 'is-connecting' : ''} ${failed ? 'is-error' : ''}`}
                    style={{ '--connection-color': endpoint.color } as CSSProperties}
                    onMouseEnter={() => setTerminalPickerIndex(index)}
                    onClick={() => selectTerminal(profile)}
                  >
                    <SquareTerminal size={15} aria-hidden="true" />
                    <span className="desktop-terminal-picker-identity">
                      <strong><HighlightedPickerText text={profile.terminalTitle} indices={matches.terminalTitle} /></strong>
                      <small>
                        <span className={`desktop-terminal-picker-status ${failed ? 'is-error' : connected ? 'is-connected' : 'is-offline'}`} aria-hidden="true" />
                        <span><HighlightedPickerText text={endpoint.label} indices={matches.endpointLabel} /></span>
                        <i>·</i>
                        <span><HighlightedPickerText text={endpoint.host} indices={matches.endpointHost} /></span>
                        {!connected && <em className={failed ? 'is-error' : ''}>{connecting ? 'Connecting' : failed ? 'Failed' : 'Offline'}</em>}
                      </small>
                    </span>
                    <span className="desktop-terminal-picker-topology">
                      <span><HighlightedPickerText text={profile.session} indices={matches.session} /></span>
                      <i>/</i>
                      <span><HighlightedPickerText text={profile.windowName} indices={matches.windowName} /></span>
                      <i>/</i>
                      <span><HighlightedPickerText text={profile.remotePaneId} indices={matches.remotePaneId} /></span>
                    </span>
                    <span className="desktop-terminal-picker-current" title={current ? 'Bound to this view' : undefined}>
                      {connecting ? <LoaderCircle size={14} className="is-spinning" aria-hidden="true" /> : current && <Check size={14} aria-hidden="true" />}
                    </span>
                  </button>
                )
              })}
              {!filteredTerminalProfiles.length && (
                <div className="desktop-terminal-picker-empty">No matching terminals</div>
              )}
            </div>
            <footer className={terminalPickerError || terminalPickerCreateError ? 'is-error' : ''}>
              <span>{remoteEndpoints.length} connections · {filteredTerminalProfiles.length} terminals</span>
              <span className="desktop-terminal-picker-footer-actions">
                {terminalPickerError ? (
                  <span className="desktop-terminal-picker-error">
                    <span role="alert">{terminalPickerError.message}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const profile = terminalProfiles.find(candidate => candidate.profileId === terminalPickerError.profileId)
                        if (profile) selectTerminal(profile)
                      }}
                    >
                      <RefreshCw size={11} aria-hidden="true" />
                      <span>Retry</span>
                    </button>
                  </span>
                ) : terminalPickerCreateError ? (
                  <span className="desktop-terminal-picker-error" role="alert">{terminalPickerCreateError}</span>
                ) : (
                  <span role="status" aria-live="polite">
                    {terminalPickerConnectingEndpoint
                      ? `Connecting to ${terminalPickerConnectingEndpoint.label}`
                      : `${DESKTOP_MANAGED_TMUX_SESSION} session`}
                  </span>
                )}
                <button type="button" className="desktop-terminal-picker-create" disabled={Boolean(terminalPickerConnectingId) || terminalPickerCreating} onClick={createTerminalFromPicker}>
                  {terminalPickerCreating ? <LoaderCircle size={12} className="is-spinning" aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                  <span>{terminalPickerCreating ? 'Creating' : 'New terminal'}</span>
                </button>
              </span>
            </footer>
          </div>
        </div>
      )}

      {mainMenuOpen && (
        <div className="desktop-pane-menu desktop-main-menu" role="menu" onPointerDown={event => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { addTab(); setMainMenuOpen(false) }}>
            <Plus size={15} /><span>New tab</span><kbd>⌘T</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => openTerminalPicker(activeTab.activePaneId)}>
            <SquareTerminal size={15} /><span>Switch terminal</span><kbd>⌘P</kbd>
          </button>
          <button type="button" role="menuitem" onClick={openTopology}>
            <Network size={15} /><span>Browse tmux topology</span><kbd>{remoteEndpoints.length}</kbd>
          </button>
          <div className="desktop-menu-divider" />
          <button type="button" role="menuitem" onClick={() => { handleSplit(activeTab.activePaneId, 'vertical'); setMainMenuOpen(false) }}>
            <Columns2 size={15} /><span>Split local view right</span><kbd>⌘D</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { handleSplit(activeTab.activePaneId, 'horizontal'); setMainMenuOpen(false) }}>
            <Rows2 size={15} /><span>Split local view below</span><kbd>⌘⇧D</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { toggleMaximize(activeTab.activePaneId); setMainMenuOpen(false) }}>
            {activeTab.maximizedPaneId ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            <span>{activeTab.maximizedPaneId ? 'Restore local layout' : 'Maximize local view'}</span><kbd>⌘⇧↩</kbd>
          </button>
          <div className="desktop-menu-divider" />
          <button type="button" role="menuitem" onClick={() => { setFilesOpen(true); setMainMenuOpen(false) }}>
            <FolderOpen size={15} /><span>Browse files</span><kbd>⌘⇧E</kbd>
          </button>
          <button type="button" role="menuitem" onClick={openBroadcastTargets}>
            <Radio size={15} /><span>{broadcast ? 'Adjust input broadcast' : 'Broadcast input'}</span><kbd>{broadcast ? broadcastTargetKeys.size : panes.length}</kbd>
          </button>
          <div className="desktop-menu-divider" />
          <button type="button" role="menuitem" onClick={() => { setSettingsOpen(true); setMainMenuOpen(false) }}>
            <Settings2 size={15} /><span>Settings</span><kbd>⌘,</kbd>
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          className="desktop-pane-menu"
          role="menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 242),
            top: Math.min(contextMenu.y, window.innerHeight - 246),
          }}
          onPointerDown={event => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => { handleSplit(contextMenu.paneId, 'vertical'); setContextMenu(null) }}>
            <Columns2 size={15} /><span>Split local view right</span><kbd>⌘D</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { handleSplit(contextMenu.paneId, 'horizontal'); setContextMenu(null) }}>
            <Rows2 size={15} /><span>Split local view below</span><kbd>⌘⇧D</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { toggleMaximize(contextMenu.paneId); setContextMenu(null) }}>
            <Maximize2 size={15} /><span>Maximize local view</span><kbd>⌘⇧↩</kbd>
          </button>
          <div className="desktop-menu-divider" />
          <button type="button" role="menuitem" onClick={() => openTerminalPicker(contextMenu.paneId)}>
            <SquareTerminal size={15} /><span>Switch terminal</span><kbd>⌘P</kbd>
          </button>
          {contextPane && (
            <button type="button" role="menuitem" onClick={() => { toggleFollowedTerminal(contextPane); setContextMenu(null) }}>
              {followedTerminalKeys.has(remotePaneKey(contextPane)) ? <EyeOff size={15} /> : <Eye size={15} />}
              <span>{followedTerminalKeys.has(remotePaneKey(contextPane)) ? 'Stop watching' : 'Watch terminal'}</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { setFilesOpen(true); setContextMenu(null) }}>
            <FolderOpen size={15} /><span>Browse files on host</span><kbd>⌘⇧E</kbd>
          </button>
          <div className="desktop-menu-divider" />
          <button type="button" role="menuitem" onClick={() => handleClosePane(contextMenu.paneId)}>
            <X size={15} /><span>Close panel view</span><kbd>⌘W</kbd>
          </button>
        </div>
      )}

      {filesOpen && (
        <aside className="desktop-file-panel" role="dialog" aria-label={`Files on ${activePane.host}`}>
          <header>
            <div>
              <strong>Files</strong>
              <span>{activePane.host}</span>
            </div>
            <button type="button" onClick={() => setFilesOpen(false)} aria-label="Close file browser"><X size={15} /></button>
          </header>
          <div className="desktop-file-toolbar">
            <span>{activePane.path}</span>
            <div>
              <button type="button" onClick={() => setNotice('File list refreshed')} aria-label="Refresh files" title="Refresh"><RefreshCw size={14} /></button>
              <button type="button" onClick={() => setNotice('Choose a file to upload')} aria-label="Upload file" title="Upload"><Upload size={14} /></button>
            </div>
          </div>
          <div className="desktop-file-list" role="listbox" aria-label="Remote files">
            {[
              { name: 'app', kind: 'folder', meta: '4 items' },
              { name: 'logs', kind: 'folder', meta: '12 items' },
              { name: 'config', kind: 'folder', meta: '3 items' },
              { name: 'deploy.sh', kind: 'file', meta: '1.8 KB' },
              { name: 'manifest.json', kind: 'file', meta: '2.4 KB' },
              { name: 'release-notes.md', kind: 'file', meta: '6.1 KB' },
            ].map(entry => (
              <button
                type="button"
                role="option"
                aria-selected={selectedFile === entry.name}
                className={selectedFile === entry.name ? 'is-selected' : ''}
                key={entry.name}
                onClick={() => setSelectedFile(entry.name)}
              >
                {entry.kind === 'folder' ? <Folder size={15} /> : <FileText size={15} />}
                <span>{entry.name}</span>
                <small>{entry.meta}</small>
              </button>
            ))}
          </div>
          <footer>
            <span>{selectedFile}</span>
            <span>{activePane.transport.toLowerCase()} · {activePane.latency} ms</span>
          </footer>
        </aside>
      )}

      {topologyMutation && (
        <TopologyMutationDialog
          state={topologyMutation}
          onChange={value => setTopologyMutation(current => current ? { ...current, value } : current)}
          onCommit={commitTopologyMutation}
          onClose={() => setTopologyMutation(null)}
        />
      )}

      {settingsOpen && <DesktopSettingsDialog currentServerId="agent-sg-prod" onClose={() => setSettingsOpen(false)} />}

      <DragOverlay dropAnimation={null} modifiers={[restrictDragOverlayToViewport]}>
        {draggedProfile && (
          <div className="desktop-topology-drag-overlay">
            <SquareTerminal size={14} aria-hidden="true" />
            <span>
              <strong>{draggedProfile.terminalTitle}</strong>
              <small>{endpointById(draggedProfile.endpointId).host} · {draggedProfile.session}/{draggedProfile.windowName} {draggedProfile.remotePaneId}</small>
            </span>
          </div>
        )}
      </DragOverlay>

      {notice && <div className="desktop-prototype-notice" role="status">{notice}</div>}
      </main>
    </DndContext>
  )
}

interface LoadedTmuxTopology {
  profiles: TerminalProfile[]
  nodes: TopologyBrowserNode[]
}

let connectedPaneSequence = 0
let connectedSplitSequence = 0
let connectedTabSequence = 0

function connectedPaneFromProfile(profile: TerminalProfile, localPaneId: string, endpoint: RemoteEndpoint): PaneLeaf {
  return {
    type: 'pane',
    id: localPaneId,
    endpointId: endpoint.id,
    endpointLabel: endpoint.label,
    connectionColor: endpoint.color,
    connectionKey: endpoint.connectionKey,
    tmuxInstanceId: profile.tmuxInstanceId ?? endpoint.tmuxInstanceId,
    terminalTitle: normalizeTerminalTitle(profile.terminalTitle, profile.remotePaneId),
    host: endpoint.host,
    path: profile.path || '/',
    session: profile.session || 'tmux',
    sessionId: profile.sessionId,
    windowName: profile.windowName || 'window',
    remotePaneId: profile.remotePaneId,
    transport: endpoint.transport,
    latency: endpoint.latency,
    detached: false,
  }
}

function connectedPlaceholderPane(remotePaneId: string, endpoint: RemoteEndpoint): PaneLeaf {
  return connectedPaneFromProfile({
    profileId: `route:${remotePaneId}`,
    endpointId: endpoint.id,
    tmuxInstanceId: endpoint.tmuxInstanceId,
    terminalTitle: remotePaneId,
    path: '/',
    session: 'tmux',
    windowName: 'window',
    remotePaneId,
  }, `desktop-pane-${++connectedPaneSequence}`, endpoint)
}

function connectedTab(pane: PaneLeaf, title = pane.terminalTitle): PrototypeTab {
  return {
    id: `desktop-tab-${++connectedTabSequence}`,
    title,
    root: pane,
    activePaneId: pane.id,
    maximizedPaneId: null,
  }
}

function syncConnectedTabTitle(tab: PrototypeTab): PrototypeTab {
  const title = desktopTabTitle(tab.activePaneId, listPanes(tab.root), tab.title)
  return title === tab.title ? tab : { ...tab, title }
}

function flattenTopologyNodes(nodes: TopologyBrowserNode[]): TopologyBrowserNode[] {
  return nodes.flatMap(node => [node, ...flattenTopologyNodes(node.children ?? [])])
}

function topologyContextForPane(nodes: TopologyBrowserNode[], pane: PaneLeaf): {
  pane?: TopologyBrowserNode
  window?: TopologyBrowserNode
  session?: TopologyBrowserNode
} {
  const flat = flattenTopologyNodes(nodes).filter(node => node.endpointId === pane.endpointId)
  return {
    pane: flat.find(node => node.kind === 'pane' && node.resourceId === pane.remotePaneId),
    window: flat.find(node => node.kind === 'window' && node.windowName === pane.windowName),
    session: flat.find(node => node.kind === 'session' && node.session === pane.session),
  }
}

function splitConnectedPane(
  node: LayoutNode,
  paneId: string,
  direction: SplitDirection,
  nextPane: PaneLeaf,
  placement: 'before' | 'after' = 'after',
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== paneId) return node
    return {
      type: 'split',
      id: `desktop-split-${++connectedSplitSequence}`,
      direction,
      ratio: 0.5,
      first: placement === 'before' ? nextPane : node,
      second: placement === 'before' ? node : nextPane,
    }
  }
  return {
    ...node,
    first: splitConnectedPane(node.first, paneId, direction, nextPane, placement),
    second: splitConnectedPane(node.second, paneId, direction, nextPane, placement),
  }
}

async function loadTmuxTopology(api: ServerApi, endpoint: RemoteEndpoint): Promise<LoadedTmuxTopology> {
  const sessions = await api.listSessions()
  const loaded = await Promise.all(sessions.map(async session => {
    const [windows, panes] = await Promise.all([
      api.listWindows(session.name),
      api.listPanes(session.name),
    ])
    return { session, windows, panes }
  }))

  const profiles: TerminalProfile[] = []
  const sessionNodes = loaded.map<TopologyBrowserNode>(({ session, windows, panes }) => {
    const windowNodes = windows.map<TopologyBrowserNode>(window => {
      const windowPanes = panes.filter(pane => pane.window_id === window.id || (windows.length === 1 && !pane.window_id))
      const children = windowPanes.map<TopologyBrowserNode>(pane => {
        const profile: TerminalProfile = {
          profileId: `${endpoint.id}:${pane.id}`,
          endpointId: endpoint.id,
          tmuxInstanceId: endpoint.tmuxInstanceId,
          terminalTitle: normalizeTerminalTitle(pane.title || pane.command || pane.id, pane.id),
          path: '/',
          session: session.name,
          windowName: window.name,
          remotePaneId: pane.id,
          sessionId: session.id,
          windowId: window.id,
        }
        profiles.push(profile)
        return {
          key: `terminal:${terminalProfileKey(profile)}`,
          kind: 'pane',
          label: profile.terminalTitle,
          meta: `${pane.id} · ${pane.command || 'shell'}`,
          endpointId: endpoint.id,
          session: session.name,
          windowName: window.name,
          resourceId: pane.id,
          profile,
        }
      })
      return {
        key: `endpoint:${endpoint.id}:session:${session.id}:window:${window.id}`,
        kind: 'window',
        label: window.name,
        meta: `${children.length} ${children.length === 1 ? 'pane' : 'panes'}`,
        endpointId: endpoint.id,
        session: session.name,
        windowName: window.name,
        resourceId: window.id,
        children,
      }
    })
    return {
      key: `endpoint:${endpoint.id}:session:${session.id}`,
      kind: 'session',
      label: session.name,
      meta: `${windowNodes.length} ${windowNodes.length === 1 ? 'window' : 'windows'}`,
      endpointId: endpoint.id,
      session: session.name,
      resourceId: session.id,
      children: windowNodes,
    }
  })

  return {
    profiles,
    nodes: [{
      key: `endpoint:${endpoint.id}`,
      kind: 'endpoint',
      label: endpoint.label,
      meta: `${endpoint.host} · ${profiles.length} ${profiles.length === 1 ? 'pane' : 'panes'}`,
      endpointId: endpoint.id,
      resourceId: endpoint.id,
      children: sessionNodes,
    }],
  }
}

function remotePath(path: string, name: string): string {
  return path === '/' ? `/${name}` : `${path.replace(/\/$/, '')}/${name}`
}

function fileSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function DesktopLiveFilePanel({
  transport,
  host,
  isRelay,
  allowRelayTransfer,
  transferProps,
  onClose,
  command,
  onCommandHandled,
  shortcuts,
}: {
  transport: WebRTCTransport
  host: string
  isRelay: boolean
  allowRelayTransfer: boolean
  transferProps: TransferProps
  onClose: () => void
  command?: { id: number; action: 'refresh' | 'new-folder' | 'upload' | 'download' | 'copy' | 'cut' | 'paste' | 'rename' | 'delete' } | null
  onCommandHandled?: () => void
  shortcuts: DesktopSettings['shortcuts']
}) {
  const fm = useFileManager(transport, isRelay, allowRelayTransfer, transferProps, '/')
  const [selected, setSelected] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const openEntry = (entry: FileEntry) => {
    const path = remotePath(fm.currentPath || '/', entry.name)
    if (entry.type === 'dir' || entry.type === 'symlink-dir') fm.handleNavigate(path)
    else fm.handlePreview(path)
  }

  useEffect(() => {
    if (!command) return
    if (command.action === 'refresh') fm.handleRefresh()
    else if (command.action === 'new-folder') fm.setShowNewDir(true)
    else if (command.action === 'upload') fileInputRef.current?.click()
    else if (command.action === 'download' && selected) fm.handleDownload(selected)
    else if (command.action === 'copy' && selected) fm.handleCopy([selected])
    else if (command.action === 'cut' && selected) fm.handleCut([selected])
    else if (command.action === 'paste') void fm.handlePaste()
    else if (command.action === 'rename' && selected) setRenameValue(selected.split('/').pop() || '')
    else if (command.action === 'delete' && selected) fm.handleDelete(selected)
    onCommandHandled?.()
  }, [command?.id])

  return (
    <aside className="desktop-file-panel" role="dialog" aria-label={`Files on ${host}`}>
      <header>
        <div><strong>Files</strong><span>{host}</span></div>
        <button type="button" onClick={onClose} aria-label="Close file browser"><X size={15} /></button>
      </header>
      <div className="desktop-file-toolbar">
        <span title={fm.currentPath || '/'}>{fm.currentPath || '/'}</span>
        <div>
          <button type="button" onClick={() => fm.handleBack()} aria-label="Parent folder" title="Parent folder"><ChevronRight className="desktop-file-up" size={14} /></button>
          <button type="button" onClick={fm.handleRefresh} aria-label="Refresh files" title={`Refresh (${formatDesktopShortcut(shortcuts.refreshFiles)})`}><RefreshCw size={14} /></button>
          <button type="button" onClick={() => fm.setShowNewDir(true)} aria-label="New folder" title={`New folder (${formatDesktopShortcut(shortcuts.newFolder)})`}><FolderPlus size={14} /></button>
          <button type="button" onClick={() => fileInputRef.current?.click()} aria-label="Upload file" title={`Upload (${formatDesktopShortcut(shortcuts.uploadFile)})`}><Upload size={14} /></button>
          <button type="button" onClick={() => void fm.handlePaste()} aria-label="Paste files" title={`Paste (${formatDesktopShortcut(shortcuts.pasteFile)})`}><ClipboardPaste size={14} /></button>
        </div>
      </div>
      {fm.showNewDir && (
        <form className="desktop-file-create" onSubmit={event => { event.preventDefault(); void fm.handleMkdir() }}>
          <input autoFocus value={fm.newDirName} onChange={event => fm.setNewDirName(event.target.value)} placeholder="Folder name" />
          <button type="submit" disabled={!fm.newDirName.trim()}><Check size={13} /></button>
          <button type="button" onClick={() => fm.setShowNewDir(false)}><X size={13} /></button>
        </form>
      )}
      {renameValue && selected && (
        <form className="desktop-file-create" onSubmit={event => {
          event.preventDefault()
          const name = renameValue.trim()
          if (!name) return
          const parent = selected.slice(0, Math.max(0, selected.lastIndexOf('/'))) || '/'
          void fm.handleRename(selected, remotePath(parent, name)).then(() => {
            setSelected('')
            setRenameValue('')
          })
        }}>
          <input autoFocus value={renameValue} onChange={event => setRenameValue(event.target.value)} aria-label="New file name" />
          <button type="submit" disabled={!renameValue.trim()}><Check size={13} /></button>
          <button type="button" onClick={() => setRenameValue('')}><X size={13} /></button>
        </form>
      )}
      {fm.confirmDelete && (
        <div className="desktop-file-confirm" role="alertdialog" aria-label="Delete selected file">
          <span>Delete {fm.confirmDelete.split('/').pop()}?</span>
          <button type="button" onClick={() => fm.setConfirmDelete(null)}>Cancel</button>
          <button type="button" className="is-danger" onClick={() => { void fm.confirmDeleteAction(); setSelected('') }}>Delete</button>
        </div>
      )}
      <div className="desktop-file-list" role="listbox" aria-label="Remote files">
        {fm.loading && <div className="desktop-file-message"><LoaderCircle className="is-spinning" size={14} /> Loading</div>}
        {!fm.loading && fm.error && <div className="desktop-file-message is-error">{fm.error}</div>}
        {!fm.loading && !fm.error && fm.visibleEntries.map(entry => {
          const path = remotePath(fm.currentPath || '/', entry.name)
          const directory = entry.type === 'dir' || entry.type === 'symlink-dir'
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected === path}
              className={selected === path ? 'is-selected' : ''}
              key={path}
              onClick={() => setSelected(path)}
              onDoubleClick={() => openEntry(entry)}
            >
              {directory ? <Folder size={15} /> : <FileText size={15} />}
              <span>{entry.name}</span>
              <small>{directory ? '' : fileSize(entry.size)}</small>
            </button>
          )
        })}
        {!fm.loading && !fm.error && fm.visibleEntries.length === 0 && <div className="desktop-file-message">Empty folder</div>}
      </div>
      <footer>
        <span>{selected ? selected.split('/').pop() : `${fm.total} items`}</span>
        {selected && <span className="desktop-file-selection-actions">
          <button type="button" onClick={() => fm.handleDownload(selected)} aria-label="Download selected file" title={`Download (${formatDesktopShortcut(shortcuts.downloadFile)})`}><Download size={13} /></button>
          <button type="button" onClick={() => fm.handleCopy([selected])} aria-label="Copy selected file" title={`Copy (${formatDesktopShortcut(shortcuts.copyFile)})`}><Copy size={12} /></button>
          <button type="button" onClick={() => fm.handleCut([selected])} aria-label="Cut selected file" title={`Cut (${formatDesktopShortcut(shortcuts.cutFile)})`}><Scissors size={12} /></button>
          <button type="button" onClick={() => setRenameValue(selected.split('/').pop() || '')} aria-label="Rename selected file" title={`Rename (${formatDesktopShortcut(shortcuts.renameFile)})`}><Pencil size={12} /></button>
          <button type="button" onClick={() => fm.handleDelete(selected)} aria-label="Delete selected file" title={`Delete (${formatDesktopShortcut(shortcuts.deleteFile)})`}><Trash2 size={12} /></button>
        </span>}
      </footer>
      <input
        ref={fileInputRef}
        className="desktop-file-input"
        type="file"
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) fm.handleUpload(file, fm.currentPath || '/')
          event.target.value = ''
        }}
      />
    </aside>
  )
}

/** Formal Wails workspace. It uses the Pencil-approved shell with live tmux and PTY data. */
export function DesktopTerminalWorkspace() {
  const { serverId = '', paneId: rawPaneId = '' } = useParams<{ serverId: string; paneId: string }>()
  const location = useLocation()
  const { storeManager } = useAppContext()
  const conn = useConnectionStore(serverId)
  const fileTransfer = useFileTransferStore(serverId)
  const isOpaqueTerminal = location.pathname.includes('/terminal/')
  const routePaneId = decodeURIComponent(rawPaneId)
  const initialRemotePaneId = isOpaqueTerminal || routePaneId.startsWith('%') ? routePaneId : `%${routePaneId}`
  const initialEndpointRef = useRef<RemoteEndpoint>({
    id: serverId || 'local',
    label: 'Local TGent',
    host: 'localhost',
    connectionKey: `local:${serverId || 'tgent'}`,
    tmuxInstanceId: 'tmux',
    transport: 'P2P',
    latency: 0,
    initialStatus: 'connected',
    color: connectionColorForKey(serverId || 'local'),
  })
  const [endpoint, setEndpoint] = useState(initialEndpointRef.current)
  const [tabs, setTabs] = useState<PrototypeTab[]>(() => [connectedTab(connectedPlaceholderPane(initialRemotePaneId, initialEndpointRef.current))])
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [warmTabIds, setWarmTabIds] = useState<string[]>(() => [tabs[0].id])
  const [terminalProfiles, setTerminalProfiles] = useState<TerminalProfile[]>([])
  const [topologyNodes, setTopologyNodes] = useState<TopologyBrowserNode[]>([])
  const [topologyExpandedKeys, setTopologyExpandedKeys] = useState<Set<string>>(new Set())
  const [topologyOpen, setTopologyOpen] = useState(false)
  const [topologyMutation, setTopologyMutation] = useState<TopologyMutationState | null>(null)
  const [connectedTopologyEndpointIds, setConnectedTopologyEndpointIds] = useState<Set<string>>(new Set())
  const [checkingTopologyEndpointIds, setCheckingTopologyEndpointIds] = useState<Set<string>>(new Set())
  const [, setTopologyLoading] = useState(false)
  const [terminalPickerPaneId, setTerminalPickerPaneId] = useState<string | null>(null)
  const [terminalQuery, setTerminalQuery] = useState('')
  const [terminalPickerIndex, setTerminalPickerIndex] = useState(0)
  const [terminalPickerCreating, setTerminalPickerCreating] = useState(false)
  const [terminalPickerCreateError, setTerminalPickerCreateError] = useState('')
  const [terminalPickerProfiles, setTerminalPickerProfiles] = useState<TerminalProfile[]>([])
  const [terminalPickerEndpoints, setTerminalPickerEndpoints] = useState<Record<string, RemoteEndpoint>>({})
  const [terminalPickerConnectionCount, setTerminalPickerConnectionCount] = useState(0)
  const [terminalPickerLoading, setTerminalPickerLoading] = useState(false)
  const [connectionTransports, setConnectionTransports] = useState<Record<string, WebRTCTransport>>({})
  const [connectionApis, setConnectionApis] = useState<Record<string, ServerApi>>({})
  const [filesOpen, setFilesOpen] = useState(false)
  const [broadcast, setBroadcast] = useState(false)
  const [broadcastTargetsOpen, setBroadcastTargetsOpen] = useState(false)
  const [broadcastTargetKeys, setBroadcastTargetKeys] = useState<Set<string>>(new Set())
  const [broadcastDraftKeys, setBroadcastDraftKeys] = useState<Set<string>>(new Set())
  const [terminalActivity, setTerminalActivity] = useState<Record<string, TerminalActivityRecord>>({})
  const [followedTerminalKeys, setFollowedTerminalKeys] = useState<Set<string>>(loadFollowedTerminalKeys)
  const [draggedProfile, setDraggedProfile] = useState<TerminalProfile | null>(null)
  const [dropPreview, setDropPreview] = useState<PaneDropPreview | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [mainMenuOpen, setMainMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(getDefaultDesktopSettings())
  const [terminalSearchOpen, setTerminalSearchOpen] = useState(false)
  const [terminalSearchQuery, setTerminalSearchQuery] = useState('')
  const terminalSearchInputRef = useRef<HTMLInputElement>(null)
  const [fileCommand, setFileCommand] = useState<{ id: number; action: 'refresh' | 'new-folder' | 'upload' | 'download' | 'copy' | 'cut' | 'paste' | 'rename' | 'delete' } | null>(null)
  const [desktopBackgroundImage, setDesktopBackgroundImage] = useState<DesktopBackgroundImage | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isRelay, setIsRelay] = useState(false)
  const terminalsRef = useRef(new Map<string, MockTerminalHandle>())
  const pendingTerminalActivityRef = useRef<Record<string, TerminalActivityRecord>>({})
  const terminalActivityFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visiblePaneIdsRef = useRef<Set<string>>(new Set())
  const workspaceRef = useRef<HTMLElement>(null)
  const pickerInputRef = useRef<HTMLInputElement>(null)
  const terminalPickerRefreshRef = useRef(0)
  const pendingTabRef = useRef<{ tabId: string; paneId: string; previousTabId: string; previousPaneId: string } | null>(null)
  const dragSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )

  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? tabs[0]
  const warmTabIdSet = useMemo(() => new Set(warmTabIds), [warmTabIds])
  const panes = useMemo(() => listPanes(activeTab.root), [activeTab.root])
  const activePane = findPane(activeTab.root, activeTab.activePaneId) ?? panes[0]
  const contextPane = contextMenu ? panes.find(pane => pane.id === contextMenu.paneId) ?? null : null

  useEffect(() => {
    if (terminalSearchOpen) requestAnimationFrame(() => terminalSearchInputRef.current?.focus())
  }, [terminalSearchOpen])

  useEffect(() => {
    setWarmTabIds(current => {
      const next = nextWarmTerminalTabs(current, activeTabId, tabs.map(tab => tab.id))
      return equalTerminalTabOrder(current, next) ? current : next
    })
  }, [activeTabId, tabs])

  useEffect(() => {
    const timer = setTimeout(() => {
      setWarmTabIds(current => current.length === 1 && current[0] === activeTabId
        ? current
        : [activeTabId])
    }, DESKTOP_WARM_TAB_TTL_MS)
    return () => clearTimeout(timer)
  }, [activeTabId])

  useEffect(() => {
    const visibleRoot = activeTab.maximizedPaneId
      ? findPane(activeTab.root, activeTab.maximizedPaneId) ?? activeTab.root
      : activeTab.root
    visiblePaneIdsRef.current = new Set(listPanes(visibleRoot).map(pane => pane.id))
  }, [activeTab.maximizedPaneId, activeTab.root])

  const resolvePaneTransport = useCallback((endpointId: string) => (
    endpointId === endpoint.id ? conn.transport : connectionTransports[endpointId]
  ), [conn.transport, connectionTransports, endpoint.id])

  const resolveConnectionApi = useCallback((endpointId: string) => (
    endpointId === endpoint.id ? conn.serverApi : connectionApis[endpointId]
  ), [conn.serverApi, connectionApis, endpoint.id])

  useEffect(() => {
    if (!serverId || !activePane || activePane.detached) return
    void rememberDesktopTerminal(serverId, activePane.remotePaneId, activePane.session)
  }, [activePane, serverId])

  const transferProps = useMemo<TransferProps>(() => ({
    transfers: fileTransfer.transfers,
    hasActiveTransfers: fileTransfer.hasActiveTransfers,
    startDownload: fileTransfer.startDownload,
    startUpload: fileTransfer.startUpload,
    startNativeUpload: fileTransfer.startNativeUpload,
    cancelTransfer: fileTransfer.cancelTransfer,
    dismissTransfer: fileTransfer.dismissTransfer,
    retryTransfer: fileTransfer.retryTransfer,
  }), [fileTransfer])

  useEffect(() => {
    let cancelled = false
    const syncEndpoint = async () => {
      const server = (await getLocalServers()).find(item => item.id === serverId)
      if (cancelled || !server) return
      setEndpoint(current => ({ ...endpointForLocalServer(server, conn), transport: current.transport, latency: current.latency }))
    }
    void syncEndpoint()
    window.addEventListener(LOCAL_SERVERS_CHANGE_EVENT, syncEndpoint)
    return () => {
      cancelled = true
      window.removeEventListener(LOCAL_SERVERS_CHANGE_EVENT, syncEndpoint)
    }
  }, [conn, serverId])

  useEffect(() => {
    if (!conn.transport || !conn.isConnected) return
    let cancelled = false
    conn.transport.getConnectionInfo().then(info => {
      if (cancelled) return
      const relay = info.type === 'relay'
      setIsRelay(relay)
      setEndpoint(current => ({ ...current, transport: relay ? 'RELAY' : 'P2P', latency: Math.round(info.rtt || 0) }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [conn.isConnected, conn.transport])

  const refreshTopology = useCallback(async () => {
    if (!conn.serverApi || !conn.isConnected) return null
    setTopologyLoading(true)
    try {
      const loaded = await loadTmuxTopology(conn.serverApi, endpoint)
      setTerminalProfiles(current => [
        ...current.filter(profile => profile.endpointId !== endpoint.id),
        ...loaded.profiles,
      ])
      setTopologyNodes(current => [
        ...current.filter(node => node.endpointId !== endpoint.id),
        ...loaded.nodes,
      ])
      setConnectedTopologyEndpointIds(current => new Set(current).add(endpoint.id))
      setTopologyExpandedKeys(current => current.size ? current : topologyBranchKeys(loaded.nodes))
      setTabs(current => current.map(tab => syncConnectedTabTitle({
        ...tab,
        root: mapLayoutPanes(tab.root, pane => {
          if (pane.endpointId !== endpoint.id) return pane
          const profile = loaded.profiles.find(candidate => candidate.remotePaneId === pane.remotePaneId)
          return profile ? connectedPaneFromProfile(profile, pane.id, endpoint) : pane
        }),
      })))
      return loaded
    } catch (error) {
      setNotice(translateError(error instanceof Error ? error.message : String(error)))
      return null
    } finally {
      setTopologyLoading(false)
    }
  }, [conn.isConnected, conn.serverApi, endpoint])

  const refreshTerminalPicker = useCallback(async () => {
    const refreshId = ++terminalPickerRefreshRef.current
    setTerminalPickerLoading(true)
    try {
      const storedServers = await getLocalServers()
      const candidates = storedServers.filter(server => !server.disabled || server.id === serverId)
      const pendingEndpoints = candidates.map(server => server.id === serverId ? endpoint : endpointForLocalServer(server))
      if (!pendingEndpoints.some(candidate => candidate.id === serverId) && conn.isConnected) pendingEndpoints.unshift(endpoint)
      if (refreshId !== terminalPickerRefreshRef.current) return
      setTerminalPickerEndpoints(current => ({
        ...current,
        ...Object.fromEntries(pendingEndpoints.map(candidate => [candidate.id, candidate])),
      }))
      setTopologyNodes(current => pendingEndpoints.map(candidate => (
        current.find(node => node.endpointId === candidate.id)
        ?? buildTopologyBrowserNodes([], [candidate])[0]
      )))
      setCheckingTopologyEndpointIds(new Set(pendingEndpoints
        .filter(candidate => candidate.id !== endpoint.id || !conn.isConnected)
        .map(candidate => candidate.id)))
      const results = await Promise.all(candidates.map(async server => {
        let snapshot: ConnectionSnapshot | null
        let targetEndpoint: RemoteEndpoint

        if (server.id === serverId) {
          snapshot = conn.isConnected && conn.transport ? conn : null
          targetEndpoint = endpoint
        } else {
          const store = storeManager.ensureStore('local', server.id, server)
          snapshot = await waitForConnectedStore(store)
          targetEndpoint = endpointForLocalServer(server, snapshot ?? undefined)
        }
        if (!snapshot?.isConnected || !snapshot.transport) {
          return {
            endpoint: targetEndpoint,
            snapshot: null,
            topology: { profiles: [], nodes: buildTopologyBrowserNodes([], [targetEndpoint]) },
          }
        }

        try {
          const topology = await loadTmuxTopology(snapshot.serverApi, targetEndpoint)
          return { endpoint: targetEndpoint, snapshot, topology }
        } catch {
          return {
            endpoint: targetEndpoint,
            snapshot: null,
            topology: { profiles: [], nodes: buildTopologyBrowserNodes([], [targetEndpoint]) },
          }
        }
      }))

      if (!candidates.some(server => server.id === serverId) && conn.isConnected && conn.transport) {
        try {
          const topology = await loadTmuxTopology(conn.serverApi, endpoint)
          results.unshift({ endpoint, snapshot: conn, topology })
        } catch {}
      }
      if (refreshId !== terminalPickerRefreshRef.current) return

      const connected = results.filter(result => result.snapshot?.isConnected && result.snapshot.transport)
      const profiles = connected.flatMap(result => result.topology.profiles)
      const nodes = results.flatMap(result => result.topology.nodes)
      const endpoints = Object.fromEntries(results.map(result => [result.endpoint.id, result.endpoint]))
      const connectedIds = new Set(connected.map(result => result.endpoint.id))
      setTerminalPickerProfiles(profiles)
      setTerminalPickerEndpoints(endpoints)
      setTerminalPickerConnectionCount(connected.length)
      setTerminalProfiles(profiles)
      setTopologyNodes(nodes)
      setConnectedTopologyEndpointIds(connectedIds)
      setCheckingTopologyEndpointIds(new Set())
      setTopologyExpandedKeys(current => {
        const available = topologyBranchKeys(nodes)
        if (!current.size) return available
        const next = new Set([...current].filter(key => available.has(key)))
        nodes.forEach(node => { if (node.children?.length) next.add(node.key) })
        return next
      })
      setConnectionTransports(Object.fromEntries(connected.map(result => [result.endpoint.id, result.snapshot!.transport!])))
      setConnectionApis(Object.fromEntries(connected.map(result => [result.endpoint.id, result.snapshot!.serverApi])))
      setTabs(current => current.map(tab => syncConnectedTabTitle({
        ...tab,
        root: mapLayoutPanes(tab.root, pane => {
          const profile = profiles.find(candidate => candidate.endpointId === pane.endpointId && candidate.remotePaneId === pane.remotePaneId)
          const profileEndpoint = endpoints[pane.endpointId]
          return profile && profileEndpoint ? connectedPaneFromProfile(profile, pane.id, profileEndpoint) : pane
        }),
      })))
    } catch (error) {
      if (refreshId === terminalPickerRefreshRef.current) {
        setCheckingTopologyEndpointIds(new Set())
        setTerminalPickerCreateError(translateError(error instanceof Error ? error.message : String(error)))
      }
    } finally {
      if (refreshId === terminalPickerRefreshRef.current) setTerminalPickerLoading(false)
    }
  }, [conn, endpoint, serverId, storeManager])

  useEffect(() => { void refreshTopology() }, [refreshTopology])

  useEffect(() => {
    void loadDesktopSettings().then(setDesktopSettings)
    const onSettingsChange = (event: Event) => {
      setDesktopSettings((event as CustomEvent<DesktopSettings>).detail)
    }
    window.addEventListener('tgent-desktop-settings-change', onSettingsChange)
    return () => window.removeEventListener('tgent-desktop-settings-change', onSettingsChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadDesktopBackgroundImage().then(image => {
      if (!cancelled) setDesktopBackgroundImage(image)
    }).catch(() => {})
    const onBackgroundChange = (event: Event) => {
      setDesktopBackgroundImage((event as CustomEvent<DesktopBackgroundImage | null>).detail)
    }
    window.addEventListener(DESKTOP_BACKGROUND_EVENT, onBackgroundChange)
    return () => {
      cancelled = true
      window.removeEventListener(DESKTOP_BACKGROUND_EVENT, onBackgroundChange)
    }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (terminalPickerPaneId) requestAnimationFrame(() => pickerInputRef.current?.focus())
  }, [terminalPickerPaneId])

  const updateActiveTab = useCallback((updater: (tab: PrototypeTab) => PrototypeTab) => {
    setTabs(current => current.map(tab => tab.id === activeTabId ? syncConnectedTabTitle(updater(tab)) : tab))
  }, [activeTabId])

  const registerTerminal = useCallback((paneId: string, handle: MockTerminalHandle | null) => {
    if (handle) terminalsRef.current.set(paneId, handle)
    else terminalsRef.current.delete(paneId)
  }, [])

  useEffect(() => {
    let firstFrame = 0
    let secondFrame = 0
    let settleTimer = 0
    const syncVisibleTerminals = (force = false) => {
      if (!force && document.visibilityState === 'hidden') return
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      window.clearTimeout(settleTimer)
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          visiblePaneIdsRef.current.forEach(paneId => terminalsRef.current.get(paneId)?.syncViewport())
        })
      })
    }
    const syncAfterNativeWindowChange = () => {
      syncVisibleTerminals(true)
      // WKWebView can report the old content rect for the first frame after its
      // view is reparented from the normal NSWindow into the Quake NSPanel.
      settleTimer = window.setTimeout(() => syncVisibleTerminals(true), 180)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncVisibleTerminals()
    }
    const onWindowFocus = () => syncVisibleTerminals()
    const runtimeBridge = (window as Window & { runtime?: DesktopRuntimeBridge }).runtime
    const unsubscribeQuake = runtimeBridge?.EventsOn?.('desktop:quake-changed', (state: unknown) => {
      const quakeState = state as { visible?: boolean } | undefined
      if (quakeState?.visible) syncAfterNativeWindowChange()
    })
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(secondFrame)
      window.clearTimeout(settleTimer)
      unsubscribeQuake?.()
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const focusPane = useCallback((paneId: string) => {
    updateActiveTab(tab => ({ ...tab, activePaneId: paneId }))
    requestAnimationFrame(() => terminalsRef.current.get(paneId)?.focus())
  }, [updateActiveTab])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    requestAnimationFrame(() => terminalsRef.current.get(activeTab.activePaneId)?.focus())
  }, [activeTab.activePaneId])

  const flushTerminalActivity = useCallback(() => {
    terminalActivityFlushTimerRef.current = null
    const pending = pendingTerminalActivityRef.current
    pendingTerminalActivityRef.current = {}
    if (!Object.keys(pending).length) return
    setTerminalActivity(current => ({ ...current, ...pending }))
  }, [])

  useEffect(() => () => {
    if (terminalActivityFlushTimerRef.current) clearTimeout(terminalActivityFlushTimerRef.current)
  }, [])

  const rememberOutput = useCallback((pane: PaneLeaf, alert: TerminalActivityAlert) => {
    const key = remotePaneKey(pane)
    const now = Date.now()
    if (alert) {
      delete pendingTerminalActivityRef.current[key]
      setTerminalActivity(current => ({ ...current, [key]: { lastOutputAt: now, alert } }))
      return
    }
    pendingTerminalActivityRef.current[key] = { lastOutputAt: now, alert: null }
    if (terminalActivityFlushTimerRef.current) return
    terminalActivityFlushTimerRef.current = setTimeout(flushTerminalActivity, 1_000)
  }, [flushTerminalActivity])

  const resolveClipboardImagePath = useCallback(async (pane: PaneLeaf, image: WailsClipboardImage) => {
    const server = await findLocalServerById(pane.endpointId)
    if (server?.socketPath) return image.localPath

    const serverType = server ? 'local' : 'hub'
    const snapshot = storeManager.getSnapshot(serverType, pane.endpointId)
    if (!snapshot.isConnected || !snapshot.transport) {
      throw new Error(`${pane.endpointLabel} 文件传输连接尚未就绪`)
    }

    setNotice(`Uploading clipboard image to ${pane.endpointLabel}`)
    try {
      const remotePath = await storeManager
        .getFileTransferStore(serverType, pane.endpointId)
        .uploadTemporaryFile(clipboardImageFile(image), '/tmp/tgent/clipboard')
      setNotice(`Image uploaded to ${pane.endpointLabel}`)
      return remotePath
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setNotice(`Image upload failed: ${message}`)
      throw error
    }
  }, [storeManager])

  const openPicker = useCallback((paneId: string) => {
    setTerminalPickerPaneId(paneId)
    setTerminalQuery('')
    setTerminalPickerIndex(0)
    setTerminalPickerCreating(false)
    setTerminalPickerCreateError('')
    setFilesOpen(false)
    setTopologyOpen(false)
    setBroadcastTargetsOpen(false)
    setMainMenuOpen(false)
    setContextMenu(null)
    setTerminalPickerProfiles(terminalProfiles)
    setTerminalPickerEndpoints({ [endpoint.id]: endpoint })
    setTerminalPickerConnectionCount(conn.isConnected ? 1 : 0)
    void refreshTerminalPicker()
  }, [conn.isConnected, endpoint, refreshTerminalPicker, terminalProfiles])

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
    setTerminalPickerPaneId(null)
    setFilesOpen(false)
    setTopologyOpen(false)
    setBroadcastTargetsOpen(false)
    setMainMenuOpen(false)
    setContextMenu(null)
  }, [])

  useEffect(() => {
    const runtimeBridge = (window as Window & { runtime?: DesktopRuntimeBridge }).runtime
    return runtimeBridge?.EventsOn?.('desktop:open-settings', openSettings)
  }, [openSettings])

  const closePicker = useCallback(() => {
    terminalPickerRefreshRef.current++
    const paneId = terminalPickerPaneId
    setTerminalPickerPaneId(null)
    setTerminalQuery('')
    setTerminalPickerCreating(false)
    setTerminalPickerCreateError('')
    const pending = pendingTabRef.current
    if (pending && pending.paneId === paneId) {
      pendingTabRef.current = null
      setTabs(current => current.filter(tab => tab.id !== pending.tabId))
      setActiveTabId(pending.previousTabId)
      requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(pending.previousPaneId)?.focus()))
      return
    }
    if (paneId) requestAnimationFrame(() => terminalsRef.current.get(paneId)?.focus())
  }, [terminalPickerPaneId])

  const selectTerminal = useCallback((profile: TerminalProfile, paneIdOverride?: string) => {
    const paneId = paneIdOverride ?? terminalPickerPaneId
    if (!paneId) return
    const existing = findTerminalLocation(tabs, profile, paneId)
    if (existing) {
      const pending = pendingTabRef.current
      if (pending?.paneId === paneId) pendingTabRef.current = null
      setTabs(current => current
        .filter(tab => tab.id !== (pending?.paneId === paneId ? pending.tabId : ''))
        .map(tab => tab.id === existing.tab.id ? syncConnectedTabTitle({ ...tab, activePaneId: existing.pane.id, maximizedPaneId: null }) : tab))
      setActiveTabId(existing.tab.id)
      setTerminalPickerPaneId(null)
      setTerminalQuery('')
      setTerminalPickerCreating(false)
      setTerminalPickerCreateError('')
      setTopologyOpen(false)
      setNotice(`${profile.terminalTitle} is already open`)
      requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(existing.pane.id)?.focus()))
      return
    }
    const selectedEndpoint = terminalPickerEndpoints[profile.endpointId] ?? (profile.endpointId === endpoint.id ? endpoint : null)
    if (!selectedEndpoint) {
      setTerminalPickerCreateError('This connection is no longer available.')
      return
    }
    const replacement = connectedPaneFromProfile(profile, paneId, selectedEndpoint)
    const previousPane = panes.find(pane => pane.id === paneId)
    updateActiveTab(tab => ({
      ...tab,
      root: replacePaneBinding(tab.root, paneId, replacement),
      activePaneId: paneId,
      maximizedPaneId: null,
      title: previousPane?.unbound ? profile.terminalTitle : tab.title,
    }))
    setTerminalActivity(current => current[remotePaneKey(replacement)] ? current : {
      ...current,
      [remotePaneKey(replacement)]: { lastOutputAt: Date.now(), alert: null },
    })
    setTerminalPickerPaneId(null)
    setTerminalQuery('')
    setTerminalPickerCreating(false)
    setTerminalPickerCreateError('')
    if (pendingTabRef.current?.paneId === paneId) pendingTabRef.current = null
    setTopologyOpen(false)
    setNotice(`Attached ${profile.terminalTitle} on ${selectedEndpoint.label}`)
  }, [endpoint, panes, tabs, terminalPickerEndpoints, terminalPickerPaneId, updateActiveTab])

  const filteredPickerResults = useMemo(() => rankTerminalProfiles(
    terminalPickerProfiles,
    profile => terminalPickerEndpoints[profile.endpointId],
    terminalQuery,
  ), [terminalPickerEndpoints, terminalPickerProfiles, terminalQuery])
  const filteredProfiles = useMemo(() => filteredPickerResults.map(result => result.profile), [filteredPickerResults])

  const moveTerminalPickerSelection = useCallback((step: number) => {
    if (!filteredProfiles.length) return
    setTerminalPickerIndex(current => (current + step + filteredProfiles.length) % filteredProfiles.length)
  }, [filteredProfiles])

  useEffect(() => {
    setTerminalPickerIndex(current => Math.min(current, Math.max(0, filteredProfiles.length - 1)))
  }, [filteredProfiles.length])

  useEffect(() => {
    if (!terminalPickerPaneId) return
    const profile = filteredProfiles[terminalPickerIndex]
    if (!profile) return
    const frame = requestAnimationFrame(() => {
      document.getElementById(`desktop-live-terminal-picker-option-${terminalProfileKey(profile)}`)?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(frame)
  }, [filteredProfiles, terminalPickerIndex, terminalPickerPaneId])

  const handleSplit = useCallback(async (paneId: string, direction: SplitDirection) => {
    const source = panes.find(pane => pane.id === paneId)
    if (!source) return
    const sourceApi = resolveConnectionApi(source.endpointId)
    const sourceEndpoint = terminalPickerEndpoints[source.endpointId] ?? (source.endpointId === endpoint.id ? endpoint : null)
    if (!sourceApi || !sourceEndpoint) return
    try {
      const created = await sourceApi.splitPane(source.remotePaneId, direction === 'vertical')
      const profile: TerminalProfile = {
        profileId: `${sourceEndpoint.id}:${created.id}`,
        endpointId: sourceEndpoint.id,
        tmuxInstanceId: sourceEndpoint.tmuxInstanceId,
        terminalTitle: normalizeTerminalTitle(created.title || created.command || created.id, created.id),
        path: source.path,
        session: source.session,
        windowName: source.windowName,
        remotePaneId: created.id,
        windowId: created.window_id,
      }
      const nextPane = connectedPaneFromProfile(profile, `desktop-pane-${++connectedPaneSequence}`, sourceEndpoint)
      updateActiveTab(tab => ({
        ...tab,
        root: splitConnectedPane(tab.root, paneId, direction, nextPane),
        activePaneId: nextPane.id,
        maximizedPaneId: null,
      }))
      if (sourceEndpoint.id === endpoint.id) {
        setTerminalProfiles(current => [...current.filter(item => item.endpointId !== profile.endpointId || item.remotePaneId !== profile.remotePaneId), profile])
      }
      setTerminalPickerProfiles(current => [...current.filter(item => item.profileId !== profile.profileId), profile])
      setTerminalActivity(current => ({ ...current, [remotePaneKey(nextPane)]: { lastOutputAt: Date.now(), alert: null } }))
      setMainMenuOpen(false)
      setContextMenu(null)
      void refreshTerminalPicker()
    } catch (error) {
      setNotice(translateError(error instanceof Error ? error.message : String(error)))
    }
  }, [endpoint, panes, refreshTerminalPicker, resolveConnectionApi, terminalPickerEndpoints, updateActiveTab])

  const closePane = useCallback((paneId: string) => {
    if (panes.length === 1) {
      terminalsRef.current.delete(paneId)
      if (tabs.length > 1) {
        const closingTabId = activeTab.id
        setTabs(current => {
          const index = current.findIndex(tab => tab.id === closingTabId)
          const nextTabs = current.filter(tab => tab.id !== closingTabId)
          setActiveTabId(nextTabs[Math.max(0, index - 1)]?.id ?? nextTabs[0].id)
          return nextTabs
        })
        setBroadcast(false)
        setBroadcastTargetKeys(new Set())
        setBroadcastDraftKeys(new Set())
        setBroadcastTargetsOpen(false)
        setContextMenu(null)
        return
      }
      const replacement = unboundPaneFrom(panes[0], paneId)
      updateActiveTab(tab => ({
        ...tab,
        title: 'New tab',
        root: replacement,
        activePaneId: paneId,
        maximizedPaneId: null,
      }))
      setBroadcast(false)
      setBroadcastTargetKeys(new Set())
      setBroadcastDraftKeys(new Set())
      setBroadcastTargetsOpen(false)
      setContextMenu(null)
      requestAnimationFrame(() => openPicker(paneId))
      return
    }
    preparePaneRemovalLayout(tabs, terminalsRef.current, paneId)
    updateActiveTab(tab => {
      const nextRoot = removePane(tab.root, paneId)
      if (!nextRoot) return tab
      const remaining = listPanes(nextRoot)
      const activePaneId = remaining.some(pane => pane.id === tab.activePaneId) ? tab.activePaneId : remaining[0].id
      return { ...tab, root: nextRoot, activePaneId, maximizedPaneId: tab.maximizedPaneId === paneId ? null : tab.maximizedPaneId }
    })
    terminalsRef.current.delete(paneId)
    setContextMenu(null)
  }, [activeTab.id, openPicker, panes, tabs.length, updateActiveTab])

  const toggleMaximize = useCallback((paneId: string) => {
    updateActiveTab(tab => ({ ...tab, activePaneId: paneId, maximizedPaneId: tab.maximizedPaneId === paneId ? null : paneId }))
  }, [updateActiveTab])

  const handleRemoteExit = useCallback((paneId: string) => {
    const pane = panes.find(item => item.id === paneId)
    const exitedKey = pane ? remotePaneKey(pane) : null
    preparePaneRemovalLayout(tabs, terminalsRef.current, paneId)
    terminalsRef.current.delete(paneId)

    setTabs(current => {
      const tabIndex = current.findIndex(tab => !!findPane(tab.root, paneId))
      if (tabIndex < 0) return current
      const tab = current[tabIndex]
      const nextRoot = removePane(tab.root, paneId)
      if (nextRoot) {
        const remaining = listPanes(nextRoot)
        const nextActivePaneId = remaining.some(item => item.id === tab.activePaneId)
          ? tab.activePaneId
          : remaining[0].id
        return current.map(item => item.id === tab.id
          ? syncConnectedTabTitle({ ...item, root: nextRoot, activePaneId: nextActivePaneId, maximizedPaneId: item.maximizedPaneId === paneId ? null : item.maximizedPaneId })
          : item)
      }
      if (current.length > 1) {
        const nextTabs = current.filter(item => item.id !== tab.id)
        if (tab.id === activeTabId) setActiveTabId(nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id)
        return nextTabs
      }
      return current.map(item => item.id === tab.id
        ? { ...item, root: mapLayoutPanes(item.root, leaf => leaf.id === paneId ? { ...leaf, detached: true } : leaf), activePaneId: paneId }
        : item)
    })

    if (exitedKey) {
      setTerminalActivity(current => {
        const next = { ...current }
        delete next[exitedKey]
        return next
      })
      setBroadcastTargetKeys(current => {
        const next = new Set(current)
        next.delete(exitedKey)
        return next
      })
      if ([...broadcastTargetKeys].filter(key => key !== exitedKey).length < 2) setBroadcast(false)
      setBroadcastDraftKeys(current => {
        const next = new Set(current)
        next.delete(exitedKey)
        return next
      })
    }
    setContextMenu(null)
  }, [activeTabId, broadcastTargetKeys, panes, tabs])

  const broadcastCandidates = useMemo(() => {
    const seen = new Set<string>()
    return panes.flatMap<BroadcastCandidate>(pane => {
      const key = remotePaneKey(pane)
      if (pane.detached || seen.has(key)) return []
      seen.add(key)
      return [{ key, pane }]
    })
  }, [panes])

  const openBroadcastTargets = useCallback(() => {
    const available = new Set(broadcastCandidates.map(candidate => candidate.key))
    setBroadcastDraftKeys(broadcast && broadcastTargetKeys.size ? new Set([...broadcastTargetKeys].filter(key => available.has(key))) : available)
    setBroadcastTargetsOpen(true)
    setTopologyOpen(false)
    setFilesOpen(false)
    setMainMenuOpen(false)
    setContextMenu(null)
  }, [broadcast, broadcastCandidates, broadcastTargetKeys])

  const handleTerminalInput = useCallback((sourcePaneId: string, data: string) => {
    if (!broadcast) return
    const source = panes.find(pane => pane.id === sourcePaneId)
    if (!source || !broadcastTargetKeys.has(remotePaneKey(source))) return
    const delivered = new Set([remotePaneKey(source)])
    terminalsRef.current.forEach((terminal, paneId) => {
      if (paneId === sourcePaneId) return
      const pane = panes.find(candidate => candidate.id === paneId)
      if (!pane) return
      const key = remotePaneKey(pane)
      if (!broadcastTargetKeys.has(key) || delivered.has(key)) return
      delivered.add(key)
      terminal.receiveInput(data)
    })
  }, [broadcast, broadcastTargetKeys, panes])

  const monitoredTerminals = useMemo(() => {
    const seen = new Set<string>()
    return tabs.flatMap<MonitoredTerminal>(tab => listPanes(tab.root).flatMap(pane => {
      const key = remotePaneKey(pane)
      if (!followedTerminalKeys.has(key) || seen.has(key)) return []
      seen.add(key)
      return [{
        key,
        tabId: tab.id,
        tabTitle: tab.title,
        pane,
        activity: terminalActivity[key] ?? { lastOutputAt: Date.now(), alert: null },
      }]
    }))
  }, [followedTerminalKeys, tabs, terminalActivity])

  const openMonitoredTerminal = useCallback((terminal: MonitoredTerminal) => {
    setActiveTabId(terminal.tabId)
    setTabs(current => current.map(tab => tab.id === terminal.tabId
      ? syncConnectedTabTitle({ ...tab, activePaneId: terminal.pane.id, maximizedPaneId: null })
      : tab))
    setFilesOpen(false)
    setTopologyOpen(false)
    setBroadcastTargetsOpen(false)
    requestAnimationFrame(() => terminalsRef.current.get(terminal.pane.id)?.focus())
  }, [])

  const toggleFollowedTerminal = useCallback((pane: PaneLeaf) => {
    const key = remotePaneKey(pane)
    setFollowedTerminalKeys(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveFollowedTerminalKeys(next)
      return next
    })
    setNotice(followedTerminalKeys.has(key) ? `Stopped watching ${pane.terminalTitle}` : `Watching ${pane.terminalTitle}`)
  }, [followedTerminalKeys])

  const placeTopologyTerminal = useCallback((profile: TerminalProfile, paneId: string, intent: PaneDropIntent) => {
    setTopologyOpen(false)
    const existing = findTerminalLocation(tabs, profile)
    if (existing) {
      setTabs(current => current.map(tab => tab.id === existing.tab.id
        ? syncConnectedTabTitle({ ...tab, activePaneId: existing.pane.id, maximizedPaneId: null })
        : tab))
      setActiveTabId(existing.tab.id)
      setNotice(`${profile.terminalTitle} is already open`)
      requestAnimationFrame(() => requestAnimationFrame(() => terminalsRef.current.get(existing.pane.id)?.focus()))
      return
    }
    if (intent === 'replace') {
      selectTerminal(profile, paneId)
      return
    }
    const profileEndpoint = terminalPickerEndpoints[profile.endpointId] ?? (profile.endpointId === endpoint.id ? endpoint : null)
    if (!profileEndpoint) {
      setNotice('This connection is no longer available')
      return
    }
    const nextPane = connectedPaneFromProfile(profile, `desktop-pane-${++connectedPaneSequence}`, profileEndpoint)
    const direction: SplitDirection = intent === 'left' || intent === 'right' ? 'vertical' : 'horizontal'
    const placement = intent === 'left' || intent === 'top' ? 'before' : 'after'
    updateActiveTab(tab => ({
      ...tab,
      root: splitConnectedPane(tab.root, paneId, direction, nextPane, placement),
      activePaneId: nextPane.id,
      maximizedPaneId: null,
    }))
    setNotice(`${paneDropLabels[intent]} · ${profile.terminalTitle}`)
  }, [endpoint, selectTerminal, tabs, terminalPickerEndpoints, updateActiveTab])

  const readDropPreview = useCallback((paneId: string, intent: PaneDropIntent): PaneDropPreview | null => {
    const element = workspaceRef.current?.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`)
    if (!element) return null
    const rect = element.getBoundingClientRect()
    const splitWidth = intent === 'left' || intent === 'right'
    const splitHeight = intent === 'top' || intent === 'bottom'
    const pixelWidth = Math.max(120, Math.round(rect.width * (splitWidth ? 0.5 : 1)))
    const pixelHeight = Math.max(90, Math.round(rect.height * (splitHeight ? 0.5 : 1)))
    return { paneId, intent, pixelWidth, pixelHeight, columns: Math.max(20, Math.floor((pixelWidth - 24) / 8.2)), rows: Math.max(4, Math.floor((pixelHeight - 43) / 16)) }
  }, [])

  const handleTopologyAction = useCallback((action: TopologyAction, node: TopologyBrowserNode) => {
    if (action === 'open' && node.profile) return placeTopologyTerminal(node.profile, activeTab.activePaneId, 'replace')
    if (action === 'split-right' && node.profile) return placeTopologyTerminal(node.profile, activeTab.activePaneId, 'right')
    if (action === 'split-below' && node.profile) return placeTopologyTerminal(node.profile, activeTab.activePaneId, 'bottom')
    if (action === 'refresh') { void refreshTerminalPicker(); return }
    if (action === 'edit-connection') { setNotice('Connection settings are managed from the home screen'); return }
    setTopologyMutation({ mode: action === 'create' ? 'create' : action === 'rename' ? 'rename' : 'delete', node, value: action === 'rename' ? node.label : '' })
  }, [activeTab.activePaneId, placeTopologyTerminal, refreshTerminalPicker])

  const commitTopologyMutation = useCallback(async () => {
    if (!topologyMutation) return
    const { mode, node } = topologyMutation
    const nodeApi = resolveConnectionApi(node.endpointId)
    if (!nodeApi) {
      setNotice('This connection is offline')
      return
    }
    const value = topologyMutation.value.trim()
    if (mode !== 'delete' && !value) return
    try {
      if (mode === 'create') {
        if (node.kind === 'endpoint') await nodeApi.createSession(value)
        else if (node.kind === 'session' && node.session) await nodeApi.createWindow(node.session, value)
        else if (node.kind === 'window') {
          const pane = terminalProfiles.find(profile => profile.endpointId === node.endpointId && profile.windowId === node.resourceId)
          if (!pane) throw new Error('This tmux window has no pane to split')
          await nodeApi.splitPane(pane.remotePaneId, true)
        }
      } else if (mode === 'rename') {
        if (node.kind === 'session' && node.resourceId) await nodeApi.renameSession(node.resourceId, value)
        else if (node.kind === 'window' && node.resourceId) await nodeApi.renameWindow(node.resourceId, value)
        else if (node.kind === 'pane' && node.resourceId) await nodeApi.renamePane(node.resourceId, value)
      } else {
        const removedProfiles = terminalProfiles.filter(profile => profile.endpointId === node.endpointId && (
          node.kind === 'session' ? profile.sessionId === node.resourceId
            : node.kind === 'window' ? profile.windowId === node.resourceId
              : node.kind === 'pane' ? profile.remotePaneId === node.resourceId
                : false))
        if (node.kind === 'session' && node.resourceId) await nodeApi.deleteSession(node.resourceId)
        else if (node.kind === 'window' && node.resourceId) await nodeApi.killWindow(node.resourceId)
        else if (node.kind === 'pane' && node.resourceId) await nodeApi.killPane(node.resourceId)
        const removed = new Set(removedProfiles.map(profile => profile.remotePaneId))
        setTabs(current => current.map(tab => ({ ...tab, root: mapLayoutPanes(tab.root, pane => pane.endpointId === node.endpointId && removed.has(pane.remotePaneId) ? { ...pane, detached: true } : pane) })))
      }
      setTopologyMutation(null)
      await refreshTerminalPicker()
    } catch (error) {
      setNotice(translateError(error instanceof Error ? error.message : String(error)))
    }
  }, [refreshTerminalPicker, resolveConnectionApi, terminalProfiles, topologyMutation])

  const createTerminalFromPicker = useCallback(async () => {
    const paneId = terminalPickerPaneId
    if (!paneId || terminalPickerCreating) return
    const targetPane = panes.find(pane => pane.id === paneId)
    if (!targetPane) return
    const targetEndpoint = terminalPickerEndpoints[targetPane.endpointId] ?? (targetPane.endpointId === endpoint.id ? endpoint : null)
    const targetApi = resolveConnectionApi(targetPane.endpointId)
    if (!targetEndpoint || !targetApi) return
    setTerminalPickerCreating(true)
    setTerminalPickerCreateError('')
    try {
      const endpointProfiles = terminalPickerProfiles.filter(profile => profile.endpointId === targetEndpoint.id)
      const managedProfiles = endpointProfiles.filter(profile => profile.session === DESKTOP_MANAGED_TMUX_SESSION)
      const managedSessionId = managedProfiles[0]?.sessionId ?? (managedProfiles.length ? DESKTOP_MANAGED_TMUX_SESSION : null)
      let createdWindowId = ''
      let createdSessionId = ''
      if (managedSessionId) {
        const window = await targetApi.createWindow(managedSessionId, `terminal-${nextManagedTerminalNumber(endpointProfiles)}`)
        createdWindowId = window.id
      } else {
        const session = await targetApi.createSession(DESKTOP_MANAGED_TMUX_SESSION)
        createdSessionId = session.id
      }
      const loaded = await loadTmuxTopology(targetApi, targetEndpoint)
      const profile = loaded.profiles.find(item => (
        createdWindowId ? item.windowId === createdWindowId : item.sessionId === createdSessionId || item.session === DESKTOP_MANAGED_TMUX_SESSION
      ))
      if (!profile) throw new Error('The new terminal was created, but its pane is not available yet.')
      setTerminalPickerProfiles(current => [
        ...current.filter(item => item.endpointId !== targetEndpoint.id),
        ...loaded.profiles,
      ])
      void refreshTerminalPicker()
      selectTerminal(profile, paneId)
    } catch (error) {
      setTerminalPickerCreating(false)
      setTerminalPickerCreateError(translateError(error instanceof Error ? error.message : String(error)))
    }
  }, [endpoint, panes, refreshTerminalPicker, resolveConnectionApi, selectTerminal, terminalPickerCreating, terminalPickerEndpoints, terminalPickerPaneId, terminalPickerProfiles])

  const addTab = useCallback(() => {
    const pane = unboundPaneFrom(activePane, `desktop-pane-${++connectedPaneSequence}`)
    const tab = connectedTab(pane, 'New tab')
    pendingTabRef.current = {
      tabId: tab.id,
      paneId: pane.id,
      previousTabId: activeTabId,
      previousPaneId: activeTab.activePaneId,
    }
    setTabs(current => [...current, tab])
    setBroadcast(false)
    setBroadcastTargetKeys(new Set())
    setBroadcastDraftKeys(new Set())
    setBroadcastTargetsOpen(false)
    setTopologyOpen(false)
    setActiveTabId(tab.id)
    openPicker(pane.id)
  }, [activePane, activeTab.activePaneId, activeTabId, openPicker])

  const closeTab = useCallback((tabId: string) => {
    setTabs(current => {
      if (current.length === 1) return current
      const index = current.findIndex(tab => tab.id === tabId)
      const next = current.filter(tab => tab.id !== tabId)
      if (tabId === activeTabId) setActiveTabId(next[Math.max(0, index - 1)]?.id ?? next[0].id)
      return next
    })
  }, [activeTabId])

  const activateLiveTab = useCallback((tabId: string) => {
    if (!tabs.some(tab => tab.id === tabId) || tabId === activeTabId) return
    setBroadcast(false)
    setBroadcastTargetKeys(new Set())
    setBroadcastDraftKeys(new Set())
    setBroadcastTargetsOpen(false)
    setTopologyOpen(false)
    setFilesOpen(false)
    setActiveTabId(tabId)
    const tab = tabs.find(candidate => candidate.id === tabId)
    if (tab) requestAnimationFrame(() => terminalsRef.current.get(tab.activePaneId)?.focus())
  }, [activeTabId, tabs])

  const cycleLiveTab = useCallback((step: number) => {
    const index = tabs.findIndex(tab => tab.id === activeTabId)
    const next = tabs[(index + step + tabs.length) % tabs.length]
    if (next) activateLiveTab(next.id)
  }, [activateLiveTab, activeTabId, tabs])

  const cycleLivePane = useCallback((step: number) => {
    const index = panes.findIndex(pane => pane.id === activeTab.activePaneId)
    const next = panes[(index + step + panes.length) % panes.length]
    if (next) focusPane(next.id)
  }, [activeTab.activePaneId, focusPane, panes])

  const focusLivePaneByDirection = useCallback((direction: 'left' | 'right' | 'up' | 'down') => {
    const workspace = workspaceRef.current
    const activeElement = workspace?.querySelector<HTMLElement>(`[data-pane-id="${activeTab.activePaneId}"]`)
    if (!workspace || !activeElement) return
    const activeRect = activeElement.getBoundingClientRect()
    const activeCenter = { x: activeRect.left + activeRect.width / 2, y: activeRect.top + activeRect.height / 2 }
    const candidates = panes.flatMap(pane => {
      if (pane.id === activeTab.activePaneId) return []
      const element = workspace.querySelector<HTMLElement>(`[data-pane-id="${pane.id}"]`)
      if (!element) return []
      const rect = element.getBoundingClientRect()
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      const primary = direction === 'left' ? activeCenter.x - center.x
        : direction === 'right' ? center.x - activeCenter.x
          : direction === 'up' ? activeCenter.y - center.y
            : center.y - activeCenter.y
      if (primary <= 1) return []
      const cross = direction === 'left' || direction === 'right'
        ? Math.abs(center.y - activeCenter.y)
        : Math.abs(center.x - activeCenter.x)
      return [{ id: pane.id, score: primary + cross * 0.65 }]
    }).sort((a, b) => a.score - b.score)
    if (candidates[0]) focusPane(candidates[0].id)
  }, [activeTab.activePaneId, focusPane, panes])

  const closeTerminalSearch = useCallback(() => {
    setTerminalSearchOpen(false)
    setTerminalSearchQuery('')
    terminalsRef.current.get(activeTab.activePaneId)?.clearSearch()
    requestAnimationFrame(() => terminalsRef.current.get(activeTab.activePaneId)?.focus())
  }, [activeTab.activePaneId])

  const runTerminalSearch = useCallback((previous = false) => {
    if (!terminalSearchQuery) return
    const terminal = terminalsRef.current.get(activeTab.activePaneId)
    if (!terminal) return
    if (previous) terminal.searchPrevious(terminalSearchQuery)
    else terminal.searchNext(terminalSearchQuery)
  }, [activeTab.activePaneId, terminalSearchQuery])

  const changeTerminalFontSize = useCallback(async (mode: 'increase' | 'decrease' | 'reset') => {
    const current = await loadTerminalSettings()
    const target = mode === 'reset'
      ? getDefaultTerminalSettings().fontSize
      : Math.max(8, Math.min(32, current.fontSize + (mode === 'increase' ? 1 : -1)))
    if (target === current.fontSize) return
    await saveTerminalSettings({ ...current, fontSize: target })
    setNotice(`Terminal font ${target}px`)
  }, [])

  const activeTopologyContext = useMemo(() => topologyContextForPane(topologyNodes, activePane), [activePane, topologyNodes])

  const renameTerminalPane = useCallback((pane: PaneLeaf) => {
    const node = topologyContextForPane(topologyNodes, pane).pane
    if (!node) { setNotice('Refresh topology before renaming this terminal'); void refreshTerminalPicker(); return }
    setTopologyMutation({ mode: 'rename', node, value: pane.terminalTitle })
  }, [refreshTerminalPicker, topologyNodes])

  const killTerminalPane = useCallback((pane: PaneLeaf) => {
    const node = topologyContextForPane(topologyNodes, pane).pane
    if (!node) { setNotice('Refresh topology before ending this terminal'); void refreshTerminalPicker(); return }
    setTopologyMutation({ mode: 'delete', node, value: '' })
  }, [refreshTerminalPicker, topologyNodes])

  const renameActiveTerminal = useCallback(() => renameTerminalPane(activePane), [activePane, renameTerminalPane])
  const killActiveTerminal = useCallback(() => killTerminalPane(activePane), [activePane, killTerminalPane])
  const mutateActiveTopologyNode = useCallback((kind: 'window' | 'session', mode: 'rename' | 'delete') => {
    const node = topologyContextForPane(topologyNodes, activePane)[kind]
    if (!node) { setNotice(`Refresh topology before ${mode === 'rename' ? 'renaming' : 'ending'} this ${kind}`); void refreshTerminalPicker(); return }
    setTopologyMutation({ mode, node, value: mode === 'rename' ? node.label : '' })
  }, [activePane, refreshTerminalPicker, topologyNodes])

  const runFileCommand = useCallback((action: 'refresh' | 'new-folder' | 'upload' | 'download' | 'copy' | 'cut' | 'paste' | 'rename' | 'delete') => {
    if (!filesOpen) {
      setFilesOpen(true)
      setTopologyOpen(false)
      setNotice(action === 'refresh' ? 'File browser opened' : 'Select a file, then run the action again')
      if (action !== 'refresh' && action !== 'new-folder' && action !== 'upload') return
    }
    setFileCommand({ id: Date.now(), action })
  }, [filesOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (settingsOpen) {
        if (matchesDesktopShortcut(event, desktopSettings.shortcuts.openSettings)) {
          event.preventDefault()
          setSettingsOpen(false)
        }
        return
      }
      if (event.key === 'Escape') {
        if (terminalSearchOpen) {
          event.preventDefault()
          closeTerminalSearch()
          return
        }
        if (terminalPickerPaneId) {
          event.preventDefault()
          closePicker()
          return
        }
        setTopologyOpen(false)
        setBroadcastTargetsOpen(false)
        setContextMenu(null)
        setMainMenuOpen(false)
        return
      }
      const matches = (action: keyof DesktopSettings['shortcuts']) => matchesDesktopShortcut(event, desktopSettings.shortcuts[action])
      const handled = () => { event.preventDefault(); event.stopPropagation() }
      if (matches('openSettings')) {
        handled()
        openSettings()
      } else if (matches('terminalPicker')) { handled(); openPicker(activeTab.activePaneId) }
      else if (matches('newTab')) { handled(); addTab() }
      else if (matches('closeView')) { handled(); closePane(activeTab.activePaneId) }
      else if (matches('closeTab')) { handled(); if (tabs.length > 1) closeTab(activeTabId); else closePane(activeTab.activePaneId) }
      else if (matches('previousTab')) { handled(); cycleLiveTab(-1) }
      else if (matches('nextTab')) { handled(); cycleLiveTab(1) }
      else if ((['selectTab1', 'selectTab2', 'selectTab3', 'selectTab4', 'selectTab5', 'selectTab6', 'selectTab7', 'selectTab8', 'selectTab9'] as const).some((action, index) => {
        if (!matches(action)) return false
        handled()
        if (tabs[index]) activateLiveTab(tabs[index].id)
        return true
      })) return
      else if (matches('splitBelow')) { handled(); void handleSplit(activeTab.activePaneId, 'horizontal') }
      else if (matches('splitRight')) { handled(); void handleSplit(activeTab.activePaneId, 'vertical') }
      else if (matches('toggleMaximize')) { handled(); toggleMaximize(activeTab.activePaneId) }
      else if (matches('previousPane')) { handled(); cycleLivePane(-1) }
      else if (matches('nextPane')) { handled(); cycleLivePane(1) }
      else if (matches('focusPaneLeft')) { handled(); focusLivePaneByDirection('left') }
      else if (matches('focusPaneRight')) { handled(); focusLivePaneByDirection('right') }
      else if (matches('focusPaneUp')) { handled(); focusLivePaneByDirection('up') }
      else if (matches('focusPaneDown')) { handled(); focusLivePaneByDirection('down') }
      else if (matches('terminalSearch')) { handled(); setTerminalSearchOpen(true) }
      else if (matches('findNext')) { handled(); if (terminalSearchQuery) runTerminalSearch(false); else setTerminalSearchOpen(true) }
      else if (matches('findPrevious')) { handled(); if (terminalSearchQuery) runTerminalSearch(true); else setTerminalSearchOpen(true) }
      else if (matches('fontIncrease')) { handled(); void changeTerminalFontSize('increase') }
      else if (matches('fontDecrease')) { handled(); void changeTerminalFontSize('decrease') }
      else if (matches('fontReset')) { handled(); void changeTerminalFontSize('reset') }
      else if (matches('reconnectTerminal')) { handled(); terminalsRef.current.get(activeTab.activePaneId)?.reconnect(); setNotice('Reconnecting terminal') }
      else if (matches('clearScrollback')) { handled(); terminalsRef.current.get(activeTab.activePaneId)?.clearScrollback() }
      else if (matches('takeSizeControl')) { handled(); terminalsRef.current.get(activeTab.activePaneId)?.takeResizeControl() }
      else if (matches('renameTerminal')) { handled(); renameActiveTerminal() }
      else if (matches('renameWindow')) { handled(); mutateActiveTopologyNode('window', 'rename') }
      else if (matches('renameSession')) { handled(); mutateActiveTopologyNode('session', 'rename') }
      else if (matches('killTerminal')) { handled(); killActiveTerminal() }
      else if (matches('killWindow')) { handled(); mutateActiveTopologyNode('window', 'delete') }
      else if (matches('killSession')) { handled(); mutateActiveTopologyNode('session', 'delete') }
      else if (matches('toggleFiles')) { handled(); setFilesOpen(value => !value); setTopologyOpen(false) }
      else if (matches('refreshFiles')) { handled(); runFileCommand('refresh') }
      else if (matches('newFolder')) { handled(); runFileCommand('new-folder') }
      else if (matches('uploadFile')) { handled(); runFileCommand('upload') }
      else if (matches('downloadFile')) { handled(); runFileCommand('download') }
      else if (matches('copyFile')) { handled(); runFileCommand('copy') }
      else if (matches('cutFile')) { handled(); runFileCommand('cut') }
      else if (matches('pasteFile')) { handled(); runFileCommand('paste') }
      else if (matches('renameFile')) { handled(); runFileCommand('rename') }
      else if (matches('deleteFile')) { handled(); runFileCommand('delete') }
      else if (matches('toggleTopology')) { handled(); setTopologyOpen(value => !value); setFilesOpen(false); void refreshTerminalPicker() }
      else if (matches('topologyRefresh')) { handled(); setTopologyOpen(true); void refreshTerminalPicker() }
      else if (matches('topologyCreate')) { handled(); const node = activeTopologyContext.window; if (node) handleTopologyAction('create', node); else { setTopologyOpen(true); void refreshTerminalPicker() } }
      else if (matches('topologyRename')) { handled(); renameActiveTerminal() }
      else if (matches('topologyDelete')) { handled(); killActiveTerminal() }
      else if (matches('broadcastInput')) { handled(); openBroadcastTargets() }
      else if (matches('hideWindow')) { handled(); (window as Window & { runtime?: DesktopRuntimeBridge }).runtime?.WindowHide?.() }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeTab.activePaneId, activeTabId, activeTopologyContext.window, activateLiveTab, addTab, changeTerminalFontSize, closePane, closePicker, closeTab, closeTerminalSearch, cycleLivePane, cycleLiveTab, desktopSettings.shortcuts, focusLivePaneByDirection, handleSplit, handleTopologyAction, killActiveTerminal, mutateActiveTopologyNode, openBroadcastTargets, openPicker, openSettings, refreshTerminalPicker, renameActiveTerminal, runFileCommand, runTerminalSearch, settingsOpen, tabs, terminalPickerPaneId, terminalSearchOpen, terminalSearchQuery, toggleMaximize])

  const pickerTarget = terminalPickerPaneId ? findPane(activeTab.root, terminalPickerPaneId) : null

  return (
    <DndContext
      sensors={dragSensors}
      collisionDetection={pointerWithin}
      onDragStart={event => {
        const data = event.active.data.current as TopologyDragData | undefined
        if (data?.type === 'topology-pane') setDraggedProfile(data.profile)
      }}
      onDragOver={event => {
        const data = event.over?.data.current as PaneDropData | undefined
        setDropPreview(data?.type === 'pane-drop' ? readDropPreview(data.paneId, data.intent) : null)
      }}
      onDragEnd={event => {
        const source = event.active.data.current as TopologyDragData | undefined
        const target = event.over?.data.current as PaneDropData | undefined
        if (source?.type === 'topology-pane' && target?.type === 'pane-drop') placeTopologyTerminal(source.profile, target.paneId, target.intent)
        setDraggedProfile(null)
        setDropPreview(null)
      }}
      onDragCancel={() => { setDraggedProfile(null); setDropPreview(null) }}
    >
      <main
        className="desktop-prototype-shell desktop-live-workspace"
        style={desktopAppearanceStyle(desktopSettings.appearance) as CSSProperties}
        onPointerDown={() => { setContextMenu(null); setMainMenuOpen(false) }}
      >
        {desktopSettings.appearance.backgroundImageEnabled && desktopBackgroundImage && (
          <div
            className="desktop-workspace-background"
            style={{
              backgroundImage: `url(${desktopBackgroundImage.url})`,
              backgroundSize: desktopSettings.appearance.backgroundImageFit,
              opacity: desktopSettings.appearance.backgroundImageOpacity,
            }}
            aria-hidden="true"
          />
        )}
        <header className="desktop-window-bar">
          <div className="desktop-traffic-lights" aria-hidden="true">
            <span className="is-close" /><span className="is-minimize" /><span className="is-zoom" />
          </div>
          <div className="desktop-tabs" role="tablist" aria-label="Terminal tabs">
            {tabs.map(tab => (
              <div
                key={tab.id}
                role="tab"
                tabIndex={0}
                aria-selected={tab.id === activeTabId}
                className={`desktop-tab ${tab.id === activeTabId ? 'is-active' : ''}`}
                onClick={() => {
                  setActiveTabId(tab.id)
                  requestAnimationFrame(() => terminalsRef.current.get(tab.activePaneId)?.focus())
                }}
              >
                <TabActivityDots panes={listPanes(tab.root)} activityRecords={terminalActivity} /><span>{tab.title}</span>
                {tabs.length > 1 && <span className="desktop-tab-close" role="button" tabIndex={0} onClick={event => { event.stopPropagation(); closeTab(tab.id) }}><X size={12} /></span>}
              </div>
            ))}
            <button
              type="button"
              className="desktop-new-tab"
              onClick={() => { void addTab() }}
              aria-label="New terminal tab"
              title={`New tab (${formatDesktopShortcut(desktopSettings.shortcuts.newTab)})`}
            >
              <Plus size={15} />
            </button>
          </div>
          <TerminalWatchStrip
            terminals={monitoredTerminals}
            activeTabId={activeTabId}
            activePaneId={activeTab.activePaneId}
            onSelect={openMonitoredTerminal}
          />
          <div className="desktop-window-tools">
            <button type="button" className={topologyOpen ? 'is-active' : ''} onClick={event => { event.stopPropagation(); setTopologyOpen(value => !value); setFilesOpen(false); setBroadcastTargetsOpen(false); void refreshTerminalPicker() }} aria-label="Open tmux topology" title={`Tmux topology (${formatDesktopShortcut(desktopSettings.shortcuts.toggleTopology)})`}><Network size={15} /></button>
            <button type="button" className={filesOpen ? 'is-active' : ''} onClick={event => { event.stopPropagation(); setFilesOpen(value => !value); setTopologyOpen(false); setBroadcastTargetsOpen(false) }} aria-label="Open file browser" title={`Files (${formatDesktopShortcut(desktopSettings.shortcuts.toggleFiles)})`}><FolderOpen size={15} /></button>
            <button type="button" className={broadcast ? 'is-broadcasting' : ''} onClick={event => { event.stopPropagation(); openBroadcastTargets() }} aria-label="Broadcast input" title={`Broadcast input (${formatDesktopShortcut(desktopSettings.shortcuts.broadcastInput)})`}><Radio size={15} />{broadcast && <span className="desktop-broadcast-count">{broadcastTargetKeys.size}</span>}</button>
            <button type="button" className={settingsOpen ? 'is-active' : ''} onClick={event => { event.stopPropagation(); openSettings() }} aria-label="Open settings" title={`Settings (${formatDesktopShortcut(desktopSettings.shortcuts.openSettings)})`}><Settings2 size={15} /></button>
            <button type="button" className={mainMenuOpen ? 'is-active' : ''} onClick={event => { event.stopPropagation(); setMainMenuOpen(value => !value) }} aria-label="More terminal actions" title="More actions"><MoreHorizontal size={16} /></button>
          </div>
        </header>

        {terminalSearchOpen && (
          <form
            className="desktop-terminal-search"
            role="search"
            onSubmit={event => { event.preventDefault(); runTerminalSearch(false) }}
          >
            <Search size={13} aria-hidden="true" />
            <input
              ref={terminalSearchInputRef}
              value={terminalSearchQuery}
              onChange={event => {
                const query = event.target.value
                setTerminalSearchQuery(query)
                if (query) terminalsRef.current.get(activeTab.activePaneId)?.searchNext(query)
                else terminalsRef.current.get(activeTab.activePaneId)?.clearSearch()
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault()
                  runTerminalSearch(true)
                }
              }}
              placeholder="Find in terminal"
              aria-label="Find in terminal"
              spellCheck={false}
            />
            <button type="button" onClick={() => runTerminalSearch(true)} disabled={!terminalSearchQuery} aria-label="Previous match" title={`Previous match (${formatDesktopShortcut(desktopSettings.shortcuts.findPrevious)})`}><ChevronRight className="is-previous" size={13} /></button>
            <button type="button" onClick={() => runTerminalSearch(false)} disabled={!terminalSearchQuery} aria-label="Next match" title={`Next match (${formatDesktopShortcut(desktopSettings.shortcuts.findNext)})`}><ChevronRight size={13} /></button>
            <button type="button" onClick={closeTerminalSearch} aria-label="Close search" title="Close search"><X size={13} /></button>
          </form>
        )}

        <section ref={workspaceRef} className={`desktop-terminal-workspace ${activeTab.maximizedPaneId ? 'is-maximized' : ''} ${broadcast ? 'is-broadcasting' : ''}`}>
          {tabs.map(tab => {
            const isActiveTab = tab.id === activeTabId
            const isWarmTab = isActiveTab || warmTabIdSet.has(tab.id)
            const visibleRoot = tab.maximizedPaneId
              ? findPane(tab.root, tab.maximizedPaneId) ?? tab.root
              : tab.root
            return (
              <div
                key={tab.id}
                className={`desktop-terminal-tab-surface ${isActiveTab ? 'is-active' : ''}`}
                data-tab-id={tab.id}
                data-terminal-residency={isWarmTab ? 'warm' : 'cold'}
                aria-hidden={!isActiveTab}
              >
                <PaneTree
                  node={visibleRoot}
                  activePaneId={isActiveTab ? tab.activePaneId : ''}
                  visible={isActiveTab}
                  suspended={!isWarmTab}
                  maximizedPaneId={tab.maximizedPaneId}
                  broadcastTargetKeys={broadcast ? broadcastTargetKeys : new Set<string>()}
                  draggedProfile={isActiveTab ? draggedProfile : null}
                  dropPreview={isActiveTab ? dropPreview : null}
                  onActivate={focusPane}
                  onInput={handleTerminalInput}
                  onOutput={rememberOutput}
                  onRemoteExit={handleRemoteExit}
                  onPasteClipboardImage={resolveClipboardImagePath}
                  onRebind={openPicker}
                  onSplit={handleSplit}
                  onToggleMaximize={toggleMaximize}
                  onClose={closePane}
                  closeShortcut={formatDesktopShortcut(desktopSettings.shortcuts.closeView)}
                  onRatioChange={(splitId, ratio) => updateActiveTab(current => ({ ...current, root: updateSplitRatio(current.root, splitId, ratio) }))}
                  onContextMenu={(event, paneId) => { event.preventDefault(); event.stopPropagation(); focusPane(paneId); setContextMenu({ paneId, x: event.clientX, y: event.clientY }) }}
                  registerTerminal={registerTerminal}
                  transport={conn.transport}
                  resolveTransport={resolvePaneTransport}
                />
              </div>
            )
          })}
        </section>

        {(!conn.isConnected || !conn.transport) && (
          <div className="desktop-live-connection-layer" role="status">
            <LoaderCircle className="is-spinning" size={17} />
            <span>{conn.statusText || 'Connecting to TGent'}</span>
          </div>
        )}

        {topologyOpen && (
          <TopologyBrowser
            targetPane={activePane}
            nodes={topologyNodes}
            paneCount={terminalProfiles.length}
            expandedKeys={topologyExpandedKeys}
            connectedEndpointIds={connectedTopologyEndpointIds}
            checkingEndpointIds={checkingTopologyEndpointIds}
            onToggle={key => setTopologyExpandedKeys(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })}
            onSelect={profile => selectTerminal(profile, activeTab.activePaneId)}
            onAction={handleTopologyAction}
            onClose={() => setTopologyOpen(false)}
          />
        )}

        {broadcastTargetsOpen && (
          <BroadcastTargetPicker
            candidates={broadcastCandidates}
            selectedKeys={broadcastDraftKeys}
            active={broadcast}
            onToggle={key => setBroadcastDraftKeys(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })}
            onApply={() => {
              if (broadcastDraftKeys.size < 2) return
              setBroadcastTargetKeys(new Set(broadcastDraftKeys))
              setBroadcast(true)
              setBroadcastTargetsOpen(false)
            }}
            onStop={() => { setBroadcast(false); setBroadcastTargetKeys(new Set()); setBroadcastDraftKeys(new Set()); setBroadcastTargetsOpen(false) }}
            onClose={() => setBroadcastTargetsOpen(false)}
          />
        )}

        {terminalPickerPaneId && (
          <div className="desktop-terminal-picker-layer" onPointerDown={closePicker}>
            <div className="desktop-terminal-picker" role="dialog" aria-modal="true" aria-label="Terminal picker" aria-busy={terminalPickerCreating || terminalPickerLoading} onPointerDown={event => event.stopPropagation()}>
              <div className="desktop-terminal-picker-search">
                <Search size={16} />
                <input
                  ref={pickerInputRef}
                  value={terminalQuery}
                  disabled={terminalPickerCreating}
                  onChange={event => { setTerminalQuery(event.target.value); setTerminalPickerIndex(0); setTerminalPickerCreateError('') }}
                  onKeyDown={event => {
                    if (event.key === 'ArrowDown') { event.preventDefault(); moveTerminalPickerSelection(1) }
                    else if (event.key === 'ArrowUp') { event.preventDefault(); moveTerminalPickerSelection(-1) }
                    else if (event.key === 'Enter') { event.preventDefault(); if (event.metaKey || event.ctrlKey) createTerminalFromPicker(); else { const profile = filteredProfiles[terminalPickerIndex]; if (profile) selectTerminal(profile) } }
                    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closePicker() }
                  }}
                  placeholder="Find a terminal"
                  aria-label="Find a terminal"
                  role="combobox"
                  aria-controls="desktop-live-terminal-picker-results"
                  aria-expanded="true"
                  aria-activedescendant={filteredProfiles[terminalPickerIndex]
                    ? `desktop-live-terminal-picker-option-${terminalProfileKey(filteredProfiles[terminalPickerIndex])}`
                    : undefined}
                  autoComplete="off"
                  spellCheck={false}
                />
                <kbd>{formatDesktopShortcut(desktopSettings.shortcuts.terminalPicker)}</kbd>
              </div>
              <div id="desktop-live-terminal-picker-results" className="desktop-terminal-picker-results" role="listbox" aria-label="Available terminals">
                {filteredPickerResults.map(({ profile, matches }, index) => {
                  const profileEndpoint = terminalPickerEndpoints[profile.endpointId] ?? endpoint
                  const current = pickerTarget?.endpointId === profile.endpointId && pickerTarget.remotePaneId === profile.remotePaneId
                  return (
                    <button id={`desktop-live-terminal-picker-option-${terminalProfileKey(profile)}`} key={terminalProfileKey(profile)} type="button" role="option" disabled={terminalPickerCreating} aria-selected={index === terminalPickerIndex} className={index === terminalPickerIndex ? 'is-selected' : ''} style={{ '--connection-color': profileEndpoint.color } as CSSProperties} onMouseEnter={() => setTerminalPickerIndex(index)} onClick={() => selectTerminal(profile)}>
                      <SquareTerminal size={15} />
                      <span className="desktop-terminal-picker-identity"><strong><HighlightedPickerText text={profile.terminalTitle} indices={matches.terminalTitle} /></strong><small><span className="desktop-terminal-picker-status is-connected" /><span><HighlightedPickerText text={profileEndpoint.label} indices={matches.endpointLabel} /></span><i>·</i><span><HighlightedPickerText text={profileEndpoint.host} indices={matches.endpointHost} /></span></small></span>
                      <span className="desktop-terminal-picker-topology"><span><HighlightedPickerText text={profile.session} indices={matches.session} /></span><i>/</i><span><HighlightedPickerText text={profile.windowName} indices={matches.windowName} /></span><i>/</i><span><HighlightedPickerText text={profile.remotePaneId} indices={matches.remotePaneId} /></span></span>
                      <span className="desktop-terminal-picker-current">{current && <Check size={14} />}</span>
                    </button>
                  )
                })}
                {!filteredProfiles.length && <div className="desktop-terminal-picker-empty">{terminalPickerLoading ? 'Loading terminals' : 'No matching terminals'}</div>}
              </div>
              <footer className={terminalPickerCreateError ? 'is-error' : ''}>
                <span>{terminalPickerConnectionCount} {terminalPickerConnectionCount === 1 ? 'connection' : 'connections'} · {filteredProfiles.length} terminals</span>
                <span className="desktop-terminal-picker-footer-actions">
                  {terminalPickerCreateError
                    ? <span className="desktop-terminal-picker-error" role="alert">{terminalPickerCreateError}</span>
                    : <span role="status" aria-live="polite">{DESKTOP_MANAGED_TMUX_SESSION} session</span>}
                  <button type="button" className="desktop-terminal-picker-create" disabled={terminalPickerCreating || !conn.serverApi} onClick={() => { void createTerminalFromPicker() }}>
                    {terminalPickerCreating ? <LoaderCircle size={12} className="is-spinning" aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                    <span>{terminalPickerCreating ? 'Creating' : 'New terminal'}</span>
                  </button>
                </span>
              </footer>
            </div>
          </div>
        )}

        {mainMenuOpen && (
          <div className="desktop-pane-menu desktop-main-menu" role="menu" onPointerDown={event => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { addTab(); setMainMenuOpen(false) }}><Plus size={15} /><span>New tab</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.newTab)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => openPicker(activeTab.activePaneId)}><SquareTerminal size={15} /><span>Switch terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.terminalPicker)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { setTopologyOpen(true); setMainMenuOpen(false); void refreshTerminalPicker() }}><Network size={15} /><span>Browse tmux topology</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.toggleTopology)}</kbd></button>
            <div className="desktop-menu-divider" />
            <button type="button" role="menuitem" onClick={() => { void handleSplit(activeTab.activePaneId, 'vertical') }}><Columns2 size={15} /><span>Split right</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.splitRight)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { void handleSplit(activeTab.activePaneId, 'horizontal') }}><Rows2 size={15} /><span>Split below</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.splitBelow)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { toggleMaximize(activeTab.activePaneId); setMainMenuOpen(false) }}>{activeTab.maximizedPaneId ? <Minimize2 size={15} /> : <Maximize2 size={15} />}<span>{activeTab.maximizedPaneId ? 'Restore layout' : 'Maximize view'}</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.toggleMaximize)}</kbd></button>
            <div className="desktop-menu-divider" />
            <button type="button" role="menuitem" onClick={() => { setTerminalSearchOpen(true); setMainMenuOpen(false) }}><Search size={15} /><span>Find in terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.terminalSearch)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { terminalsRef.current.get(activeTab.activePaneId)?.reconnect(); setMainMenuOpen(false) }}><RefreshCw size={15} /><span>Reconnect terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.reconnectTerminal)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { terminalsRef.current.get(activeTab.activePaneId)?.takeResizeControl(); setMainMenuOpen(false) }}><Maximize2 size={15} /><span>Take size control</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.takeSizeControl)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { renameActiveTerminal(); setMainMenuOpen(false) }}><Pencil size={15} /><span>Rename terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.renameTerminal)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { mutateActiveTopologyNode('window', 'rename'); setMainMenuOpen(false) }}><Pencil size={15} /><span>Rename tmux window</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.renameWindow)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { mutateActiveTopologyNode('session', 'rename'); setMainMenuOpen(false) }}><Pencil size={15} /><span>Rename tmux session</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.renameSession)}</kbd></button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { killActiveTerminal(); setMainMenuOpen(false) }}><Trash2 size={15} /><span>Kill terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.killTerminal)}</kbd></button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { mutateActiveTopologyNode('window', 'delete'); setMainMenuOpen(false) }}><Trash2 size={15} /><span>Kill tmux window</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.killWindow)}</kbd></button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { mutateActiveTopologyNode('session', 'delete'); setMainMenuOpen(false) }}><Trash2 size={15} /><span>Kill tmux session</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.killSession)}</kbd></button>
            <div className="desktop-menu-divider" />
            <button type="button" role="menuitem" onClick={() => { setFilesOpen(true); setMainMenuOpen(false) }}><FolderOpen size={15} /><span>Browse files</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.toggleFiles)}</kbd></button>
            <button type="button" role="menuitem" onClick={openBroadcastTargets}><Radio size={15} /><span>Broadcast input</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.broadcastInput)}</kbd></button>
            <div className="desktop-menu-divider" />
            <button type="button" role="menuitem" onClick={openSettings}><Settings2 size={15} /><span>Settings</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.openSettings)}</kbd></button>
          </div>
        )}

        {contextMenu && (
          <div className="desktop-pane-menu" role="menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 242), top: Math.min(contextMenu.y, window.innerHeight - 246) }} onPointerDown={event => event.stopPropagation()}>
            <button type="button" role="menuitem" onClick={() => { void handleSplit(contextMenu.paneId, 'vertical') }}><Columns2 size={15} /><span>Split right</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.splitRight)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { void handleSplit(contextMenu.paneId, 'horizontal') }}><Rows2 size={15} /><span>Split below</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.splitBelow)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { toggleMaximize(contextMenu.paneId); setContextMenu(null) }}><Maximize2 size={15} /><span>Maximize view</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.toggleMaximize)}</kbd></button>
            <div className="desktop-menu-divider" />
            <button type="button" role="menuitem" onClick={() => openPicker(contextMenu.paneId)}><SquareTerminal size={15} /><span>Switch terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.terminalPicker)}</kbd></button>
            {contextPane && <button type="button" role="menuitem" onClick={() => { toggleFollowedTerminal(contextPane); setContextMenu(null) }}>
              {followedTerminalKeys.has(remotePaneKey(contextPane)) ? <EyeOff size={15} /> : <Eye size={15} />}
              <span>{followedTerminalKeys.has(remotePaneKey(contextPane)) ? 'Stop watching' : 'Watch terminal'}</span>
            </button>}
            <button type="button" role="menuitem" onClick={() => { setTerminalSearchOpen(true); setContextMenu(null) }}><Search size={15} /><span>Find in terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.terminalSearch)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { terminalsRef.current.get(contextMenu.paneId)?.reconnect(); setContextMenu(null) }}><RefreshCw size={15} /><span>Reconnect terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.reconnectTerminal)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { terminalsRef.current.get(contextMenu.paneId)?.takeResizeControl(); setContextMenu(null) }}><Maximize2 size={15} /><span>Take size control</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.takeSizeControl)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => { setFilesOpen(true); setContextMenu(null) }}><FolderOpen size={15} /><span>Browse files</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.toggleFiles)}</kbd></button>
            <div className="desktop-menu-divider" />
            <button type="button" role="menuitem" onClick={() => { const pane = panes.find(item => item.id === contextMenu.paneId); if (pane) renameTerminalPane(pane); setContextMenu(null) }}><Pencil size={15} /><span>Rename terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.renameTerminal)}</kbd></button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { const pane = panes.find(item => item.id === contextMenu.paneId); if (pane) killTerminalPane(pane); setContextMenu(null) }}><Trash2 size={15} /><span>Kill terminal</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.killTerminal)}</kbd></button>
            <button type="button" role="menuitem" onClick={() => closePane(contextMenu.paneId)}><X size={15} /><span>Close panel view</span><kbd>{formatDesktopShortcut(desktopSettings.shortcuts.closeView)}</kbd></button>
          </div>
        )}

        {filesOpen && conn.transport && (
          <DesktopLiveFilePanel
            transport={conn.transport}
            host={activePane.host}
            isRelay={isRelay}
            allowRelayTransfer={conn.allowRelayTransfer}
            transferProps={transferProps}
            command={fileCommand}
            onCommandHandled={() => setFileCommand(null)}
            shortcuts={desktopSettings.shortcuts}
            onClose={() => setFilesOpen(false)}
          />
        )}

        {topologyMutation && (
          <TopologyMutationDialog state={topologyMutation} onChange={value => setTopologyMutation(current => current ? { ...current, value } : current)} onCommit={() => { void commitTopologyMutation() }} onClose={() => setTopologyMutation(null)} />
        )}

        {settingsOpen && <DesktopSettingsDialog currentServerId={serverId} onClose={closeSettings} />}

        <DragOverlay dropAnimation={null} modifiers={[restrictDragOverlayToViewport]}>
          {draggedProfile && <div className="desktop-topology-drag-overlay"><SquareTerminal size={14} /><span><strong>{draggedProfile.terminalTitle}</strong><small>{endpoint.host} · {draggedProfile.session}/{draggedProfile.windowName} {draggedProfile.remotePaneId}</small></span></div>}
        </DragOverlay>

        {notice && <div className="desktop-prototype-notice" role="status">{notice}</div>}
      </main>
    </DndContext>
  )
}
