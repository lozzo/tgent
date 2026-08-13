// ========== API 类型定义 ==========

export interface Session {
  id: string
  name: string
  windows: number
  created?: string
}

export interface Window {
  id: string
  index: number
  name: string
  panes: number
}

export interface Pane {
  id: string
  index: number
  title: string
  command: string
  width: number
  height: number
  window_id?: string
}

export interface ProviderCapabilities {
  create_session: boolean
  create_child: boolean
  rename: boolean
  close: boolean
  move: boolean
  reorder: boolean
  split: boolean
  zoom: boolean
}

export interface TerminalProvider {
  kind: string
  id: string
  name: string
  running: boolean
  capabilities: ProviderCapabilities
}

export interface TopologyNodeCapabilities {
  create_child: boolean
  rename: boolean
  close: boolean
  move: boolean
  reorder: boolean
  split: boolean
  zoom: boolean
}

export interface TopologyNode {
  id: string
  provider_id: string
  kind: string
  name: string
  terminal_id?: string
  children?: TopologyNode[]
  capabilities: TopologyNodeCapabilities
  metadata?: Record<string, string>
}

export interface ProviderTopology {
  provider: TerminalProvider
  revision: number
  nodes: TopologyNode[]
  error?: string
}

export interface TerminalCapabilities {
  raw_stream: boolean
  frame_stream: boolean
  snapshot: boolean
  scrollback: boolean
  send_input: boolean
  send_keys: boolean
  viewer_resize: boolean
  precise_term_state: boolean
}

export interface TerminalInfo {
  id: string
  provider_kind: string
  provider_id: string
  title: string
  command: string
  cwd: string
  columns: number
  rows: number
  status: 'running' | 'exited' | 'unknown'
  capabilities: TerminalCapabilities
}

export interface TerminalProtocolCapabilities {
  api_versions: number[]
  datachannel_versions: number[]
  event_versions: number[]
  providers: TerminalProvider[]
}

export interface TopologyApi {
  capabilities: () => Promise<TerminalProtocolCapabilities>
  listProviders: () => Promise<TerminalProvider[]>
  getTopology: () => Promise<ProviderTopology[]>
  getTerminal: (terminalId: string) => Promise<TerminalInfo>
}

export interface AgentStatus {
  enabled: boolean
  hub_addr?: string
  connected?: boolean
  agent_id?: string
  version?: string
}

export interface AgentInfo {
  id: string
  name: string
  hostname: string
  osInfo: string | null
  labels: string | null
  online: boolean
  paired: boolean
  hubId: string | null
  hubHttpUrl: string | null
  tokenId: string | null
  tokenName: string | null
  lastSeen: string | null
  createdAt: string
}

export interface UserInfo {
  id: string
  username: string
  email: string
  role: string
  createdAt?: string
}

export interface SubscriptionInfo {
  active: boolean
  planName: string
  currentPeriodEnd: string
}

export interface WebRequestOptions {
  silent?: boolean
  skipAuthRefresh?: boolean
}

export interface HubRequestOptions {
  hubUrl: string
  hubToken: string
}

/** ServerApi 类型 - 服务器级别的 API 类型 */
export interface ServerApi {
  topology?: TopologyApi
  status: () => Promise<{ tmux_running: boolean; sessions: number }>

  listSessions: () => Promise<Session[]>
  createSession: (name: string, cwd?: string) => Promise<Session>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>

  listWindows: (sessionId: string) => Promise<Window[]>
  createWindow: (sessionId: string, name: string) => Promise<Window>
  killWindow: (windowId: string) => Promise<void>
  renameWindow: (windowId: string, name: string) => Promise<void>
  moveWindow: (windowId: string, targetSession: string) => Promise<void>
  swapWindow: (windowId: string, targetWindowId: string) => Promise<void>

  listPanes: (sessionId: string) => Promise<Pane[]>
  movePane: (paneId: string, targetWindowId: string) => Promise<void>
  splitPane: (paneId: string, horizontal: boolean) => Promise<Pane>
  renamePane: (paneId: string, name: string) => Promise<void>
  killPane: (paneId: string) => Promise<void>
  capturePane: (paneId: string) => Promise<{ pane_id: string; content: string }>
}
