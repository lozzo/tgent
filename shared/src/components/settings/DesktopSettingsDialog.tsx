import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleUserRound,
  Cloud,
  Eye,
  EyeOff,
  ImagePlus,
  Keyboard,
  LoaderCircle,
  MonitorCog,
  Network,
  PanelTop,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Server,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import { webApi, type AgentInfo, type SubscriptionInfo, type UserInfo } from '../../api/client'
import { useAppContext } from '../../contexts/AppContext'
import {
  addOrUpdateByHubAgentId,
  attachHubIdentity,
  CONNECTION_COLOR_OPTIONS,
  connectionColorForKey,
  getConnectionColor,
  getLocalServers,
  removeLocalServer,
  updateLocalServer,
  type LocalServer,
} from '../../lib/localServers'
import {
  clearWebUrl,
  DEFAULT_WEB_URL,
  getWebToken,
  getWebUrl,
  getWailsDesktopStatus,
  isCustomWebUrl,
  isWailsApp,
  setWailsQuakeEnabled,
  setWailsQuakeShortcut,
  setWebUrl,
  updateWailsQuakeSettings,
  validateLocalTGent,
  type WailsDesktopStatus,
} from '../../lib/platform'
import {
  DESKTOP_SHORTCUTS,
  formatDesktopShortcut,
  getDefaultDesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
  shortcutFromKeyboardEvent,
  type DesktopChromeTone,
  type DesktopSettings,
  type DesktopShortcutAction,
} from '../../lib/desktopSettings'
import {
  loadDesktopBackgroundImage,
  removeDesktopBackgroundImage,
  saveDesktopBackgroundImage,
  type DesktopBackgroundImage,
} from '../../lib/desktopBackground'
import { applyTheme, getAllThemes, getTheme, loadThemeId, saveThemeId } from '../../lib/themes'
import {
  FONT_OPTIONS,
  getDefaultTerminalSettings,
  loadTerminalSettings,
  saveTerminalSettings,
  type TerminalSettings,
} from '../../lib/terminalSettings'
import { translateError } from '../../lib/errors'
import PairCodeDialog from '../common/PairCodeDialog'

type SettingsSection = 'connections' | 'account' | 'appearance' | 'terminal' | 'quake' | 'shortcuts'
type AccountMode = 'login' | 'register'

interface DesktopSettingsDialogProps {
  currentServerId: string
  initialSection?: SettingsSection
  onClose: () => void
}

interface ConnectionEditor {
  id?: string
  name: string
  addr: string
  password: string
  color: string
}

const sections: Array<{
  id: SettingsSection
  label: string
  description: string
  icon: typeof Network
}> = [
  { id: 'connections', label: 'Connections', description: 'Endpoints and agents', icon: Network },
  { id: 'account', label: 'Account', description: 'Cloud identity', icon: CircleUserRound },
  { id: 'appearance', label: 'Appearance', description: 'Chrome and colors', icon: Palette },
  { id: 'terminal', label: 'Terminal', description: 'Font and rendering', icon: MonitorCog },
  { id: 'quake', label: 'Quake Mode', description: 'Drop-down window', icon: PanelTop },
  { id: 'shortcuts', label: 'Shortcuts', description: 'Desktop key bindings', icon: Keyboard },
]

const accentOptions = ['#78a9ff', '#58c78c', '#e4b45f', '#ef7478', '#b6bdc8']

function normalizeAddress(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function connectionSubtitle(server: LocalServer): string {
  const sources = [server.socketPath || server.addr]
  if (server.hubAgentId) sources.push('Cloud')
  return sources.filter(Boolean).join(' · ') || 'No endpoint configured'
}

function SettingsNav({ active, onSelect }: { active: SettingsSection; onSelect: (section: SettingsSection) => void }) {
  return (
    <nav className="desktop-settings-nav" aria-label="Settings sections">
      {sections.map(section => {
        const Icon = section.icon
        return (
          <button
            key={section.id}
            type="button"
            className={active === section.id ? 'is-active' : ''}
            aria-current={active === section.id ? 'page' : undefined}
            onClick={() => onSelect(section.id)}
          >
            <Icon size={15} />
            <span><strong>{section.label}</strong><small>{section.description}</small></span>
          </button>
        )
      })}
    </nav>
  )
}

function ConnectionsSettings({ currentServerId, onClose }: { currentServerId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const [connections, setConnections] = useState<LocalServer[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<ConnectionEditor | null>(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [revealPassword, setRevealPassword] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [pairingAgent, setPairingAgent] = useState<{ agent: AgentInfo; localServer?: LocalServer } | null>(null)
  const identityCheckedRef = useRef(new Set<string>())

  const reconcileStoredIdentities = useCallback(async (locals: LocalServer[]) => {
    if (!isWailsApp()) return
    const candidates = locals.filter(server => server.addr && !server.hubAgentId && !identityCheckedRef.current.has(server.id))
    candidates.forEach(server => identityCheckedRef.current.add(server.id))
    if (!candidates.length) return
    const validations = await Promise.all(candidates.map(async server => ({
      server,
      validation: await validateLocalTGent(server.addr, server.password).catch(() => null),
    })))
    let changed = false
    for (const { server, validation } of validations) {
      if (!validation?.ok || !validation.agentId) continue
      await attachHubIdentity(server.id, validation.agentId, validation.hubAddr)
      changed = true
    }
    if (changed) setConnections(await getLocalServers())
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    const [locals, token] = await Promise.all([getLocalServers(), getWebToken()])
    setConnections(locals)
    if (token) {
      try { setAgents(await webApi.listAgents()) } catch { setAgents([]) }
    } else {
      setAgents([])
    }
    setLoading(false)
    void reconcileStoredIdentities(locals)
  }, [reconcileStoredIdentities])

  useEffect(() => { void reload() }, [reload])

  const editConnection = (server: LocalServer) => {
    setEditor({ id: server.id, name: server.name, addr: server.addr, password: server.password, color: getConnectionColor(server) })
    setError('')
    setRevealPassword(false)
  }

  const saveConnection = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const addr = normalizeAddress(editor.addr)
    const existing = editor.id ? connections.find(item => item.id === editor.id) : undefined
    if (!addr && !existing?.socketPath) {
      setError('Enter the HTTP or HTTPS endpoint for this TGent daemon.')
      return
    }
    setTesting(true)
    setError('')
    try {
      let agentId = existing?.hubAgentId
      let hubAddr = existing?.hubAddr
      if (addr) {
        const validation = await validateLocalTGent(addr, editor.password)
        if (!validation.ok) {
          if (validation.requiresPassword) throw new Error('This endpoint requires its daemon password.')
          if (validation.error === 'invalid_password') throw new Error('The daemon password is incorrect.')
          if (validation.error === 'not_tgent') throw new Error('The address responded, but it is not a TGent endpoint.')
          if (validation.error === 'invalid_address') throw new Error('Enter a valid HTTP or HTTPS address.')
          throw new Error('TGent could not reach this endpoint.')
        }
        agentId = validation.agentId || agentId
        hubAddr = validation.hubAddr || hubAddr
      }
      const name = editor.name.trim() || (addr ? new URL(addr).hostname : existing?.name || 'TGent')
      if (editor.id) {
        await updateLocalServer(editor.id, { name, addr, password: editor.password, color: editor.color })
        if (agentId) await attachHubIdentity(editor.id, agentId, hubAddr)
      } else {
        await addOrUpdateByHubAgentId({ name, addr, password: editor.password, color: editor.color, hubAgentId: agentId, hubAddr })
      }
      setEditor(null)
      await reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setTesting(false)
    }
  }

  const connect = (id: string) => {
    onClose()
    navigate(`/s/${encodeURIComponent(id)}`)
  }

  const setConnectionEnabled = async (server: LocalServer, enabled: boolean) => {
    await updateLocalServer(server.id, { disabled: !enabled })
    await reload()
  }

  const openCloudAgent = (agent: AgentInfo) => {
    const saved = connections.find(server => server.hubAgentId === agent.id)
    if (saved && (saved.privateKeySeed || saved.pairCode)) {
      onClose()
      navigate(`/s/${encodeURIComponent(saved.id)}`)
      return
    }
    setPairingAgent({ agent, localServer: saved })
  }

  const unlinkedAgents = agents.filter(agent => !connections.some(server => server.hubAgentId === agent.id))

  return (
    <section className="desktop-settings-section" aria-labelledby="desktop-settings-connections-title">
      <header className="desktop-settings-section-header">
        <div><h2 id="desktop-settings-connections-title">Connections</h2><p>Direct endpoints work without an account. Cloud agents appear after you sign in.</p></div>
        {!editor && <button type="button" className="desktop-settings-command" onClick={() => setEditor({ name: '', addr: '', password: '', color: CONNECTION_COLOR_OPTIONS[connections.length % CONNECTION_COLOR_OPTIONS.length] })}><Plus size={14} />Add endpoint</button>}
      </header>

      {editor && (
        <form className="desktop-settings-editor" onSubmit={saveConnection}>
          <div className="desktop-settings-editor-heading">
            <strong>{editor.id ? 'Edit endpoint' : 'New endpoint'}</strong>
            <button type="button" onClick={() => { setEditor(null); setError('') }} aria-label="Cancel editing"><X size={14} /></button>
          </div>
          <label><span>Name</span><input autoFocus value={editor.name} onChange={event => setEditor(current => current ? { ...current, name: event.target.value } : current)} placeholder="Build server" /></label>
          <label><span>Endpoint</span><input type="url" value={editor.addr} onChange={event => { setEditor(current => current ? { ...current, addr: event.target.value } : current); setError('') }} placeholder="http://192.168.1.100:8080" /></label>
          <label className="desktop-settings-password-field">
            <span>Daemon password</span>
            <div className="desktop-settings-password">
              <input type={revealPassword ? 'text' : 'password'} value={editor.password} onChange={event => { setEditor(current => current ? { ...current, password: event.target.value } : current); setError('') }} placeholder="Only when endpoint authentication is enabled" />
              <button type="button" onClick={() => setRevealPassword(value => !value)} aria-label={revealPassword ? 'Hide password' : 'Show password'} title={revealPassword ? 'Hide password' : 'Show password'}>{revealPassword ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
          </label>
          <label className="desktop-settings-color-field">
            <span>Connection color</span>
            <span className="desktop-settings-color-options">
              {CONNECTION_COLOR_OPTIONS.map(color => (
                <button key={color} type="button" className={editor.color.toLowerCase() === color ? 'is-selected' : ''} style={{ '--connection-color': color } as CSSProperties} onClick={() => setEditor(current => current ? { ...current, color } : current)} aria-label={`Use connection color ${color}`} aria-pressed={editor.color.toLowerCase() === color}><span /></button>
              ))}
              <span className="desktop-settings-custom-color" title="Custom connection color">
                <input type="color" value={editor.color} onChange={event => setEditor(current => current ? { ...current, color: event.target.value } : current)} aria-label="Custom connection color" />
              </span>
            </span>
          </label>
          {error && <p className="desktop-settings-error" role="alert">{error}</p>}
          <footer><button type="button" onClick={() => setEditor(null)}>Cancel</button><button type="submit" className="is-primary" disabled={testing}>{testing && <LoaderCircle className="is-spinning" size={13} />}{testing ? 'Testing' : editor.id ? 'Test and save' : 'Test and add'}</button></footer>
        </form>
      )}

      <div className="desktop-settings-list" aria-busy={loading}>
        <div className="desktop-settings-list-label">Direct endpoints</div>
        {loading && <div className="desktop-settings-empty"><LoaderCircle className="is-spinning" size={15} />Loading connections</div>}
        {!loading && connections.map(server => {
          const current = server.id === currentServerId
          const enabled = !server.disabled
          return (
            <div className={`desktop-settings-connection-row ${enabled ? '' : 'is-disabled'}`} key={server.id} style={{ '--connection-color': getConnectionColor(server) } as CSSProperties}>
              <span className={`desktop-settings-connection-icon ${server.socketPath ? 'is-local' : ''}`}>{server.socketPath ? <Server size={15} /> : <Network size={15} />}</span>
              <span className="desktop-settings-connection-copy"><strong>{server.name}{current && <em>Current</em>}{!enabled && <em className="is-disabled">Disabled</em>}</strong><small title={connectionSubtitle(server)}>{connectionSubtitle(server)}</small></span>
              {deleteId === server.id ? (
                <span className="desktop-settings-delete-confirm"><small>Remove?</small><button type="button" onClick={() => setDeleteId(null)}>Cancel</button><button type="button" className="is-danger" onClick={() => { void removeLocalServer(server.id).then(() => { setDeleteId(null); void reload() }) }}>Remove</button></span>
              ) : (
                <span className="desktop-settings-row-actions">
                  <button type="button" role="switch" aria-label={`Enable ${server.name}`} aria-checked={enabled} className={`desktop-settings-switch desktop-settings-connection-switch ${enabled ? 'is-on' : ''}`} onClick={() => { void setConnectionEnabled(server, !enabled) }} title={enabled ? 'Disable connection' : 'Enable connection'}><span /></button>
                  <button type="button" onClick={() => editConnection(server)} aria-label={`Edit ${server.name}`} title="Edit endpoint"><Pencil size={14} /></button>
                  <button type="button" disabled={current} onClick={() => setDeleteId(server.id)} aria-label={`Remove ${server.name}`} title={current ? 'Current connection cannot be removed' : 'Remove endpoint'}><Trash2 size={14} /></button>
                  <button type="button" className="is-open" disabled={current || !enabled} onClick={() => connect(server.id)} aria-label={`Connect to ${server.name}`} title={!enabled ? 'Connection is disabled' : current ? 'Current connection' : 'Connect'}>{current ? <Check size={14} /> : <ArrowRight size={14} />}</button>
                </span>
              )}
            </div>
          )
        })}
        {!loading && connections.length === 0 && <div className="desktop-settings-empty">No direct endpoints saved.</div>}

        <div className="desktop-settings-list-label is-spaced">Cloud agents</div>
        {!loading && unlinkedAgents.map(agent => {
          const action = 'Pair'
          return (
            <div className="desktop-settings-connection-row" key={agent.id} style={{ '--connection-color': connectionColorForKey(agent.id) } as CSSProperties}>
              <span className="desktop-settings-connection-icon"><Cloud size={15} /></span>
              <span className="desktop-settings-connection-copy"><strong>{agent.name || agent.hostname}</strong><small>{agent.hostname} · {agent.online ? 'Online' : 'Offline'} · Pair required</small></span>
              <span className="desktop-settings-row-actions">
                <button type="button" className="is-open" disabled={!agent.online} onClick={() => openCloudAgent(agent)} aria-label={`${action} ${agent.name || agent.hostname}`} title={!agent.online ? 'Agent is offline' : action}><ArrowRight size={14} /></button>
              </span>
            </div>
          )
        })}
        {!loading && agents.length === 0 && <div className="desktop-settings-empty">Sign in to see TGent agents linked to your account.</div>}
        {!loading && agents.length > 0 && unlinkedAgents.length === 0 && <div className="desktop-settings-empty">All cloud agents are merged with saved connections.</div>}
      </div>
      {pairingAgent && (
        <PairCodeDialog
          open
          variant="desktop"
          agentId={pairingAgent.agent.id}
          agentName={pairingAgent.agent.name || pairingAgent.agent.hostname}
          localServer={pairingAgent.localServer}
          onClose={() => setPairingAgent(null)}
          onPaired={() => {
            setPairingAgent(null)
            void reload()
          }}
        />
      )}
    </section>
  )
}

function AccountSettings() {
  const { authManager, storeManager } = useAppContext()
  const [mode, setMode] = useState<AccountMode>('login')
  const [user, setUser] = useState<UserInfo | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [webUrl, setWebUrlInput] = useState(DEFAULT_WEB_URL)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadAccount = useCallback(async () => {
    setLoading(true)
    setWebUrlInput(await getWebUrl())
    const token = await getWebToken()
    if (!token) {
      setUser(null)
      setSubscription(null)
      setLoading(false)
      return
    }
    try {
      const result = await webApi.getMe()
      setUser(result.user)
      setSubscription(result.subscription)
    } catch {
      setUser(null)
      setSubscription(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadAccount() }, [loadAccount])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!username.trim() || !password) return
    if (mode === 'register') {
      if (!email.trim()) { setError('Enter an email address.'); return }
      if (password.length < 6) { setError('Password must contain at least 6 characters.'); return }
      if (password !== confirmPassword) { setError('The two passwords do not match.'); return }
    }
    setLoading(true)
    setError('')
    try {
      const normalizedUrl = normalizeAddress(webUrl)
      if (!/^https?:\/\//i.test(normalizedUrl)) throw new Error('Account service must use an HTTP or HTTPS address.')
      const previousUrl = await getWebUrl()
      if (normalizedUrl !== previousUrl) {
        await setWebUrl(normalizedUrl)
        storeManager.releaseAllStores()
      }
      const result = mode === 'login'
        ? await webApi.login(username.trim(), password)
        : await webApi.register(username.trim(), email.trim(), password)
      await authManager.setTokens(result.token, result.refresh_token)
      setUser(result.user)
      setPassword('')
      setConfirmPassword('')
      try {
        const me = await webApi.getMe()
        setSubscription(me.subscription)
      } catch {}
    } catch (reason) {
      setError(translateError(reason instanceof Error ? reason.message : String(reason)))
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    setLoading(true)
    await authManager.logout()
    storeManager.releaseHubStores()
    setUser(null)
    setSubscription(null)
    setLoading(false)
  }

  const restoreDefaultUrl = async () => {
    if (await isCustomWebUrl()) {
      await clearWebUrl()
      storeManager.releaseAllStores()
    }
    setWebUrlInput(DEFAULT_WEB_URL)
  }

  return (
    <section className="desktop-settings-section" aria-labelledby="desktop-settings-account-title">
      <header className="desktop-settings-section-header"><div><h2 id="desktop-settings-account-title">Account</h2><p>Signing in adds cloud agents. Local and direct endpoints continue to work without it.</p></div></header>
      {loading && !user ? <div className="desktop-settings-empty is-large"><LoaderCircle className="is-spinning" size={16} />Checking account</div> : user ? (
        <div className="desktop-settings-account-summary">
          <span className="desktop-settings-avatar">{user.username.slice(0, 1).toUpperCase()}</span>
          <div><strong>{user.username}</strong><small>{user.email}</small></div>
          <span className="desktop-settings-plan">{subscription?.active ? subscription.planName : 'Free'}</span>
          <button type="button" onClick={() => { void logout() }}>Sign out</button>
        </div>
      ) : (
        <>
          <div className="desktop-settings-segmented" role="tablist" aria-label="Account action">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'is-active' : ''} onClick={() => { setMode('login'); setError('') }}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'is-active' : ''} onClick={() => { setMode('register'); setError('') }}>Create account</button>
          </div>
          <form className="desktop-settings-account-form" onSubmit={submit}>
            <label><span>Account service</span><div className="desktop-settings-input-action"><input type="url" value={webUrl} onChange={event => setWebUrlInput(event.target.value)} /><button type="button" onClick={() => { void restoreDefaultUrl() }} aria-label="Restore default account service" title="Restore default"><RotateCcw size={13} /></button></div><small>Change this only when using a self-hosted TGent account service.</small></label>
            <label><span>Username</span><input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
            {mode === 'register' && <label><span>Email</span><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>}
            <label><span>Password</span><div className="desktop-settings-password"><input type={passwordVisible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /><button type="button" onClick={() => setPasswordVisible(value => !value)} aria-label={passwordVisible ? 'Hide password' : 'Show password'}>{passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}</button></div></label>
            {mode === 'register' && <label><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>}
            {error && <p className="desktop-settings-error" role="alert">{error}</p>}
            <button type="submit" className="desktop-settings-submit" disabled={loading || !username.trim() || !password}>{loading && <LoaderCircle className="is-spinning" size={13} />}{mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
        </>
      )}
    </section>
  )
}

function AppearanceSettings({ settings, onChange }: { settings: DesktopSettings; onChange: (settings: DesktopSettings) => void }) {
  const [themeId, setThemeId] = useState('tokyo-night')
  const [backgroundImage, setBackgroundImage] = useState<DesktopBackgroundImage | null>(null)
  const [backgroundBusy, setBackgroundBusy] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const themes = useMemo(() => getAllThemes(), [])
  const selectedTheme = getTheme(themeId)

  useEffect(() => { void loadThemeId().then(setThemeId) }, [])
  useEffect(() => {
    let cancelled = false
    void loadDesktopBackgroundImage()
      .then(image => { if (!cancelled) setBackgroundImage(image) })
      .catch(reason => { if (!cancelled) setBackgroundError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [])

  const selectTheme = (id: string) => {
    setThemeId(id)
    void saveThemeId(id)
    applyTheme(getTheme(id))
  }

  const updateAppearance = (patch: Partial<DesktopSettings['appearance']>) => {
    const next = { ...settings, appearance: { ...settings.appearance, ...patch } }
    onChange(next)
    void saveDesktopSettings(next)
  }

  const chooseBackground = async (file: File | undefined) => {
    if (!file) return
    setBackgroundBusy(true)
    setBackgroundError('')
    try {
      const image = await saveDesktopBackgroundImage(file)
      setBackgroundImage(image)
      updateAppearance({
        backgroundImageEnabled: true,
        windowOpacity: settings.appearance.windowOpacity > 0.9 ? 0.82 : settings.appearance.windowOpacity,
      })
    } catch (reason) {
      setBackgroundError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBackgroundBusy(false)
      if (backgroundInputRef.current) backgroundInputRef.current.value = ''
    }
  }

  const removeBackground = async () => {
    setBackgroundBusy(true)
    setBackgroundError('')
    try {
      await removeDesktopBackgroundImage()
      setBackgroundImage(null)
      updateAppearance({ backgroundImageEnabled: false })
    } catch (reason) {
      setBackgroundError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBackgroundBusy(false)
    }
  }

  const chromeTones: Array<{ id: DesktopChromeTone; label: string }> = [
    { id: 'obsidian', label: 'Obsidian' },
    { id: 'graphite', label: 'Graphite' },
    { id: 'midnight', label: 'Midnight' },
    { id: 'evergreen', label: 'Evergreen' },
  ]

  return (
    <section className="desktop-settings-section" aria-labelledby="desktop-settings-appearance-title">
      <header className="desktop-settings-section-header"><div><h2 id="desktop-settings-appearance-title">Appearance</h2><p>Keep the workspace quiet, then choose the terminal palette that carries your sessions.</p></div></header>
      <div className="desktop-settings-control-group">
        <div className="desktop-settings-control-copy"><strong>Window chrome</strong><small>Choose the contrast of tabs, dialogs, and tool surfaces.</small></div>
        <div className="desktop-settings-segmented is-inline" role="radiogroup" aria-label="Window chrome">
          {chromeTones.map(tone => <button key={tone.id} type="button" role="radio" aria-checked={settings.appearance.chromeTone === tone.id} className={settings.appearance.chromeTone === tone.id ? 'is-active' : ''} onClick={() => updateAppearance({ chromeTone: tone.id })}>{tone.label}</button>)}
        </div>
      </div>
      <div className="desktop-settings-control-group">
        <div className="desktop-settings-control-copy"><strong>Accent</strong><small>Used for focus, active tabs, and selected terminal views.</small></div>
        <div className="desktop-settings-swatches">
          {accentOptions.map(color => <button key={color} type="button" className={settings.appearance.accent.toLowerCase() === color ? 'is-selected' : ''} style={{ '--swatch': color } as CSSProperties} onClick={() => updateAppearance({ accent: color })} aria-label={`Use accent ${color}`} aria-pressed={settings.appearance.accent.toLowerCase() === color} title={color}>{settings.appearance.accent.toLowerCase() === color && <Check size={11} />}</button>)}
          <label title="Custom accent"><input type="color" value={settings.appearance.accent} onChange={event => updateAppearance({ accent: event.target.value })} aria-label="Custom accent color" /><Settings2 size={13} /></label>
        </div>
      </div>
      <div className="desktop-settings-control-group">
        <div className="desktop-settings-control-copy"><strong>Window opacity</strong><small>Adjust the native window and terminal background without fading text.</small></div>
        <label className="desktop-settings-range">
          <input type="range" min="55" max="100" step="1" value={Math.round(settings.appearance.windowOpacity * 100)} onChange={event => updateAppearance({ windowOpacity: Number(event.target.value) / 100 })} aria-label="Window opacity" />
          <output>{Math.round(settings.appearance.windowOpacity * 100)}%</output>
        </label>
      </div>
      <div className="desktop-settings-control-group">
        <div className="desktop-settings-control-copy"><strong>Background image</strong><small>{backgroundImage?.name ?? 'Add a local image behind terminal surfaces.'}</small></div>
        <div className="desktop-settings-background-actions">
          {backgroundImage && <span className="desktop-settings-background-thumb" style={{ backgroundImage: `url(${backgroundImage.url})` }} aria-hidden="true" />}
          {backgroundImage && <button type="button" role="switch" aria-checked={settings.appearance.backgroundImageEnabled} className={`desktop-settings-switch ${settings.appearance.backgroundImageEnabled ? 'is-on' : ''}`} onClick={() => updateAppearance({ backgroundImageEnabled: !settings.appearance.backgroundImageEnabled })} title={settings.appearance.backgroundImageEnabled ? 'Hide background image' : 'Show background image'}><span /></button>}
          <button type="button" className="desktop-settings-command" disabled={backgroundBusy} onClick={() => backgroundInputRef.current?.click()}>{backgroundBusy ? <LoaderCircle className="is-spinning" size={13} /> : <ImagePlus size={13} />}{backgroundImage ? 'Replace' : 'Choose image'}</button>
          {backgroundImage && <button type="button" className="desktop-settings-icon-command" disabled={backgroundBusy} onClick={() => { void removeBackground() }} aria-label="Remove background image" title="Remove background image"><Trash2 size={13} /></button>}
          <input ref={backgroundInputRef} className="desktop-settings-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={event => { void chooseBackground(event.target.files?.[0]) }} />
        </div>
      </div>
      {backgroundImage && (
        <div className="desktop-settings-background-options">
          <label className="desktop-settings-range is-wide"><span>Image visibility</span><input type="range" min="10" max="100" step="1" value={Math.round(settings.appearance.backgroundImageOpacity * 100)} onChange={event => updateAppearance({ backgroundImageOpacity: Number(event.target.value) / 100 })} aria-label="Background image visibility" /><output>{Math.round(settings.appearance.backgroundImageOpacity * 100)}%</output></label>
          <div className="desktop-settings-segmented is-inline" role="radiogroup" aria-label="Background image fit">
            <button type="button" role="radio" aria-checked={settings.appearance.backgroundImageFit === 'cover'} className={settings.appearance.backgroundImageFit === 'cover' ? 'is-active' : ''} onClick={() => updateAppearance({ backgroundImageFit: 'cover' })}>Fill</button>
            <button type="button" role="radio" aria-checked={settings.appearance.backgroundImageFit === 'contain'} className={settings.appearance.backgroundImageFit === 'contain' ? 'is-active' : ''} onClick={() => updateAppearance({ backgroundImageFit: 'contain' })}>Fit</button>
          </div>
        </div>
      )}
      {backgroundError && <p className="desktop-settings-error" role="alert">{backgroundError}</p>}
      <div className="desktop-settings-theme-layout">
        <div className="desktop-settings-theme-list" role="listbox" aria-label="Terminal color schemes">
          {themes.map(theme => (
            <button type="button" role="option" aria-label={`${theme.name}, ${theme.group} theme`} aria-selected={theme.id === themeId} className={theme.id === themeId ? 'is-selected' : ''} key={theme.id} onClick={() => selectTheme(theme.id)}>
              <span className="desktop-settings-theme-dots" aria-hidden="true">{[theme.terminal.red, theme.terminal.yellow, theme.terminal.green, theme.terminal.blue].map((color, index) => <i key={index} style={{ backgroundColor: color as string }} />)}</span>
              <span><strong>{theme.name}</strong><small>{theme.group === 'dark' ? 'Dark' : 'Light'}</small></span>
              {theme.id === themeId && <Check size={13} />}
            </button>
          ))}
        </div>
        <div className="desktop-settings-terminal-preview" style={{ backgroundColor: selectedTheme.terminal.background, color: selectedTheme.terminal.foreground }}>
          <header><span /><span /><span /><small>{selectedTheme.name}</small></header>
          <pre><span style={{ color: selectedTheme.terminal.green as string }}>tgent</span> <i>main</i> <b>$</b> tmux list-sessions{`\n`}main: 3 windows <em>(attached)</em>{`\n`}deploy: 2 windows{`\n\n`}<span style={{ color: selectedTheme.terminal.blue as string }}>~</span> <b>$</b> <u>_</u></pre>
        </div>
      </div>
    </section>
  )
}

function TerminalSettingsPanel() {
  const [settings, setSettings] = useState<TerminalSettings>(getDefaultTerminalSettings())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => { void loadTerminalSettings().then(value => { setSettings(value); setLoaded(true) }) }, [])

  const update = (patch: Partial<TerminalSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    void saveTerminalSettings(next)
  }

  if (!loaded) return <div className="desktop-settings-empty is-large"><LoaderCircle className="is-spinning" size={16} />Loading terminal settings</div>

  return (
    <section className="desktop-settings-section" aria-labelledby="desktop-settings-terminal-title">
      <header className="desktop-settings-section-header"><div><h2 id="desktop-settings-terminal-title">Terminal</h2><p>Changes are applied immediately to every open terminal view.</p></div></header>
      <div className="desktop-settings-form-rows">
        <label className="desktop-settings-form-row"><span><strong>Font family</strong><small>Nerd Font glyphs are bundled with the app.</small></span><span className="desktop-settings-select"><select value={settings.fontFamily} onChange={event => update({ fontFamily: event.target.value })}>{FONT_OPTIONS.map(font => <option value={font.value} key={font.value}>{font.label}</option>)}</select><ChevronDown size={13} /></span></label>
        <div className="desktop-settings-form-row"><span><strong>Font size</strong><small>Applies to all live and future terminal panes.</small></span><span className="desktop-settings-stepper"><button type="button" onClick={() => update({ fontSize: Math.max(8, settings.fontSize - 1) })} aria-label="Decrease font size">−</button><output>{settings.fontSize}px</output><button type="button" onClick={() => update({ fontSize: Math.min(32, settings.fontSize + 1) })} aria-label="Increase font size">+</button></span></div>
        <label className="desktop-settings-form-row"><span><strong>Scrollback</strong><small>Number of lines retained in each terminal.</small></span><span className="desktop-settings-select"><select value={settings.scrollback} onChange={event => update({ scrollback: Number(event.target.value) })}>{[1000, 5000, 10000, 25000, 50000].map(value => <option value={value} key={value}>{value.toLocaleString()} lines</option>)}</select><ChevronDown size={13} /></span></label>
        <label className="desktop-settings-form-row"><span><strong>Renderer</strong><small>Automatic mode selects the most stable renderer.</small></span><span className="desktop-settings-select"><select value={settings.renderer} onChange={event => update({ renderer: event.target.value as TerminalSettings['renderer'] })}><option value="auto">Automatic</option><option value="webgl">WebGL</option><option value="canvas">Canvas</option></select><ChevronDown size={13} /></span></label>
        <div className="desktop-settings-form-row"><span><strong>Blinking cursor</strong><small>Animate the cursor in focused terminal panes.</small></span><button type="button" role="switch" aria-checked={settings.cursorBlink} className={`desktop-settings-switch ${settings.cursorBlink ? 'is-on' : ''}`} onClick={() => update({ cursorBlink: !settings.cursorBlink })}><span /></button></div>
      </div>
    </section>
  )
}

function QuakeSettingsPanel({ settings, onChange }: { settings: DesktopSettings; onChange: (settings: DesktopSettings) => void }) {
  const [status, setStatus] = useState<WailsDesktopStatus | null>(null)
  const [statusLoaded, setStatusLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [shortcutBusy, setShortcutBusy] = useState(false)
  const [shortcutFeedback, setShortcutFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    void getWailsDesktopStatus()
      .then(value => { if (!cancelled) setStatus(value) })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!cancelled) setStatusLoaded(true) })
    return () => { cancelled = true }
  }, [])

  const saveQuake = (next: DesktopSettings) => {
    onChange(next)
    void saveDesktopSettings(next)
  }

  const updateWindow = (patch: Partial<DesktopSettings['quake']>) => {
    const next = { ...settings, quake: { ...settings.quake, ...patch } }
    saveQuake(next)
    setError('')
    void updateWailsQuakeSettings(next.quake).catch(reason => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const toggleEnabled = async () => {
    const enabled = !settings.quake.enabled
    setBusy(true)
    setError('')
    try {
      const nextStatus = await setWailsQuakeEnabled(enabled)
      setStatus(nextStatus)
      saveQuake({ ...settings, quake: { ...settings.quake, enabled } })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      try { setStatus(await getWailsDesktopStatus()) } catch {}
    } finally {
      setBusy(false)
    }
  }

  const saveShortcut = useCallback(async (shortcut: string) => {
    const conflict = shortcut ? DESKTOP_SHORTCUTS.find(item => settings.shortcuts[item.action] === shortcut) : null
    if (conflict) {
      setShortcutFeedback({ tone: 'error', message: `Already used by ${conflict.label}` })
      return
    }
    setShortcutBusy(true)
    setShortcutFeedback(null)
    try {
      const nextStatus = await setWailsQuakeShortcut(shortcut)
      if (nextStatus) setStatus(nextStatus)
      const next = { ...settings, quake: { ...settings.quake, shortcut } }
      saveQuake(next)
      setRecordingShortcut(false)
      setShortcutFeedback({ tone: 'success', message: `${formatDesktopShortcut(shortcut)} saved` })
    } catch (reason) {
      setShortcutFeedback({ tone: 'error', message: reason instanceof Error ? reason.message : String(reason) })
    } finally {
      setShortcutBusy(false)
    }
  }, [settings])

  const captureShortcut = useCallback((event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (event.repeat || shortcutBusy) return
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return
    if (event.key === 'Escape') {
      setRecordingShortcut(false)
      setShortcutFeedback(null)
      return
    }
    if (event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      void saveShortcut(getDefaultDesktopSettings().quake.shortcut)
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event)
    if (!shortcut) {
      setShortcutFeedback({ tone: 'error', message: 'Add Command, Control, Alt, or use a function key' })
      return
    }
    void saveShortcut(shortcut)
  }, [saveShortcut, shortcutBusy])

  useEffect(() => {
    if (!recordingShortcut) return
    const onKeyDown = (event: KeyboardEvent) => captureShortcut(event)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [captureShortcut, recordingShortcut])

  useEffect(() => {
    if (shortcutFeedback?.tone !== 'success') return
    const timer = window.setTimeout(() => setShortcutFeedback(current => current === shortcutFeedback ? null : current), 1800)
    return () => window.clearTimeout(timer)
  }, [shortcutFeedback])

  const runtimeState = !settings.quake.enabled
    ? 'disabled'
    : status?.hotkeyAvailable
      ? 'ready'
      : status?.hotkeyError
        ? 'error'
        : statusLoaded
          ? 'unavailable'
          : 'checking'
  const runtimeLabel = runtimeState === 'ready'
    ? 'Global hotkey ready'
    : runtimeState === 'disabled'
      ? 'Disabled'
      : runtimeState === 'checking'
        ? 'Checking hotkey'
        : 'Hotkey unavailable'

  return (
    <section className="desktop-settings-section" aria-labelledby="desktop-settings-quake-title">
      <header className="desktop-settings-section-header">
        <div><h2 id="desktop-settings-quake-title">Quake Mode</h2><p>Drop TGent from the top of the active display and return to the previous window layout when you leave.</p></div>
        <span className={`desktop-settings-runtime-status is-${runtimeState}`} role="status"><i />{runtimeLabel}</span>
      </header>
      {(error || status?.hotkeyError) && <p className="desktop-settings-error is-quake" role="alert">{error || status?.hotkeyError}</p>}
      <div className="desktop-settings-form-rows">
        <div className="desktop-settings-form-row">
          <span><strong>Enable Quake Mode</strong><small>Register the system-wide shortcut when TGent starts.</small></span>
          <button type="button" role="switch" aria-label="Enable Quake Mode" aria-checked={settings.quake.enabled} disabled={busy || !isWailsApp()} className={`desktop-settings-switch ${settings.quake.enabled ? 'is-on' : ''}`} onClick={() => { void toggleEnabled() }}><span /></button>
        </div>
        <div className="desktop-settings-form-row">
          <span><strong>Global shortcut</strong><small>Show or hide TGent from any application.</small></span>
          <div className="desktop-settings-shortcut-control desktop-settings-quake-control">
            <button
              type="button"
              className={`desktop-settings-quake-shortcut ${recordingShortcut ? 'is-recording' : ''}`}
              aria-label={`Change Quake Mode shortcut. Current shortcut ${formatDesktopShortcut(settings.quake.shortcut)}`}
              aria-pressed={recordingShortcut}
              aria-describedby={recordingShortcut || shortcutFeedback ? 'desktop-quake-shortcut-status' : undefined}
              disabled={shortcutBusy || !isWailsApp()}
              onClick={() => { setRecordingShortcut(true); setShortcutFeedback(null) }}
            >
              {shortcutBusy
                ? <><LoaderCircle className="is-spinning" size={12} aria-hidden="true" /><span>Registering</span></>
                : recordingShortcut
                  ? <><i aria-hidden="true" /><Keyboard size={12} aria-hidden="true" /><span>Press keys</span></>
                  : <kbd>{formatDesktopShortcut(settings.quake.shortcut)}</kbd>}
            </button>
            <small
              id="desktop-quake-shortcut-status"
              className={shortcutFeedback ? `is-${shortcutFeedback.tone}` : ''}
              role={shortcutFeedback?.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {shortcutFeedback?.message ?? (recordingShortcut ? 'Esc to cancel' : '')}
            </small>
          </div>
        </div>
        <label className="desktop-settings-form-row" htmlFor="desktop-quake-height">
          <span><strong>Window height</strong><small>Percentage of the active display used by the drop-down window.</small></span>
          <span className="desktop-settings-range">
            <input id="desktop-quake-height" type="range" min="30" max="90" step="5" value={Math.round(settings.quake.heightRatio * 100)} onChange={event => updateWindow({ heightRatio: Number(event.target.value) / 100 })} />
            <output htmlFor="desktop-quake-height">{Math.round(settings.quake.heightRatio * 100)}%</output>
          </span>
        </label>
        <div className="desktop-settings-form-row">
          <span><strong>Always on top</strong><small>Keep the Quake window above other applications while it is visible.</small></span>
          <button type="button" role="switch" aria-label="Keep Quake window always on top" aria-checked={settings.quake.alwaysOnTop} className={`desktop-settings-switch ${settings.quake.alwaysOnTop ? 'is-on' : ''}`} onClick={() => updateWindow({ alwaysOnTop: !settings.quake.alwaysOnTop })}><span /></button>
        </div>
      </div>
    </section>
  )
}

function ShortcutSettings({ settings, onChange }: { settings: DesktopSettings; onChange: (settings: DesktopSettings) => void }) {
  const [recording, setRecording] = useState<DesktopShortcutAction | null>(null)
  const [query, setQuery] = useState('')
  const [feedback, setFeedback] = useState<{
    action: DesktopShortcutAction
    tone: 'error' | 'success'
    message: string
  } | null>(null)

  const capture = useCallback((action: DesktopShortcutAction, event: KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (event.repeat) return
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return
    if (event.key === 'Escape') {
      setRecording(null)
      setFeedback(null)
      return
    }
    if (event.key === 'Backspace' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      const fallback = getDefaultDesktopSettings().shortcuts[action]
      const next = { ...settings, shortcuts: { ...settings.shortcuts, [action]: fallback } }
      onChange(next)
      void saveDesktopSettings(next)
      setRecording(null)
      setFeedback({ action, tone: 'success', message: 'Default restored' })
      return
    }
    if (event.key === 'Delete' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      const next = { ...settings, shortcuts: { ...settings.shortcuts, [action]: '' } }
      onChange(next)
      void saveDesktopSettings(next)
      setRecording(null)
      setFeedback({ action, tone: 'success', message: 'Shortcut cleared' })
      return
    }
    const shortcut = shortcutFromKeyboardEvent(event)
    if (!shortcut) {
      setFeedback({ action, tone: 'error', message: 'Add Command, Control, or use a function key' })
      return
    }
    const conflict = DESKTOP_SHORTCUTS.find(item => item.action !== action && settings.shortcuts[item.action] === shortcut)
    if (conflict) {
      setFeedback({ action, tone: 'error', message: `Already used by ${conflict.label}` })
      return
    }
    if (settings.quake.shortcut === shortcut) {
      setFeedback({ action, tone: 'error', message: 'Already used by Quake Mode' })
      return
    }
    const next = { ...settings, shortcuts: { ...settings.shortcuts, [action]: shortcut } }
    onChange(next)
    void saveDesktopSettings(next)
    setRecording(null)
    setFeedback({ action, tone: 'success', message: `${formatDesktopShortcut(shortcut)} saved` })
  }, [onChange, settings])

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent) => capture(recording, event)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [capture, recording])

  useEffect(() => {
    if (feedback?.tone !== 'success') return
    const timer = window.setTimeout(() => setFeedback(current => current === feedback ? null : current), 1800)
    return () => window.clearTimeout(timer)
  }, [feedback])

  const beginRecording = (action: DesktopShortcutAction) => {
    setRecording(action)
    setFeedback(null)
  }

  const reset = () => {
    const next = { ...settings, shortcuts: { ...getDefaultDesktopSettings().shortcuts } }
    onChange(next)
    void saveDesktopSettings(next)
    setRecording(null)
    setFeedback(null)
  }

  const visibleShortcuts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return DESKTOP_SHORTCUTS
    const terms = normalized.split(/\s+/).filter(Boolean)
    return DESKTOP_SHORTCUTS.filter(item => {
      const haystack = `${item.group} ${item.label} ${item.description}`.toLocaleLowerCase()
      return terms.every(term => haystack.includes(term))
    })
  }, [query])

  return (
    <section className="desktop-settings-section" aria-labelledby="desktop-settings-shortcuts-title">
      <header className="desktop-settings-section-header"><div><h2 id="desktop-settings-shortcuts-title">Shortcuts</h2><p>Select a binding and press new keys. Backspace restores its default; Delete leaves it unassigned.</p></div><button type="button" className="desktop-settings-command" onClick={reset}><RotateCcw size={13} />Reset all</button></header>
      <label className="desktop-settings-shortcut-search">
        <Search size={13} aria-hidden="true" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter shortcuts" aria-label="Filter shortcuts" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear shortcut filter"><X size={12} /></button>}
      </label>
      <div className="desktop-settings-shortcut-list">
        {[...new Set(visibleShortcuts.map(item => item.group))].map(group => (
          <section className="desktop-settings-shortcut-group" aria-labelledby={`desktop-shortcut-group-${group}`} key={group}>
            <h3 id={`desktop-shortcut-group-${group}`}>{group}</h3>
            {visibleShortcuts.filter(item => item.group === group).map(item => {
              const isRecording = recording === item.action
              const itemFeedback = feedback?.action === item.action ? feedback : null
              const statusId = `desktop-shortcut-status-${item.action}`
              const shortcut = settings.shortcuts[item.action]
              const formatted = formatDesktopShortcut(shortcut)
              return (
                <div className={`desktop-settings-shortcut-row ${isRecording ? 'is-recording' : ''}`} key={item.action}>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                  <div className="desktop-settings-shortcut-control">
                    <button
                      type="button"
                      className={`${isRecording ? 'is-recording' : ''} ${shortcut ? '' : 'is-unassigned'}`}
                      aria-label={`Change shortcut for ${item.label}. Current shortcut ${formatted}`}
                      aria-pressed={isRecording}
                      aria-describedby={isRecording || itemFeedback ? statusId : undefined}
                      onClick={() => beginRecording(item.action)}
                    >
                      {isRecording ? <><i aria-hidden="true" /><Keyboard size={12} aria-hidden="true" /><span>Press keys</span></> : <kbd>{formatted}</kbd>}
                    </button>
                    <small
                      id={statusId}
                      className={itemFeedback ? `is-${itemFeedback.tone}` : ''}
                      role={itemFeedback?.tone === 'error' ? 'alert' : 'status'}
                      aria-live="polite"
                    >
                      {itemFeedback?.message ?? (isRecording ? 'Esc cancel · Delete clear' : '')}
                    </small>
                  </div>
                </div>
              )
            })}
          </section>
        ))}
        {!visibleShortcuts.length && <div className="desktop-settings-empty">No matching shortcuts</div>}
      </div>
    </section>
  )
}

function DesktopSettingsDialog({ currentServerId, initialSection = 'connections', onClose }: DesktopSettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)
  const [desktopSettings, setDesktopSettings] = useState<DesktopSettings>(getDefaultDesktopSettings())
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { void loadDesktopSettings().then(setDesktopSettings) }, [])
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>('.desktop-settings-nav button[aria-current="page"]')?.focus()
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.desktop-pairing-dialog')) return
      const recording = Boolean(dialogRef.current?.querySelector('.desktop-settings-shortcut-control > button.is-recording'))
      if (event.key === 'Escape') {
        if (recording) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || recording) return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        .filter(element => element.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  return (
    <div className="desktop-settings-layer">
      <div ref={dialogRef} className="desktop-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="desktop-settings-title" onPointerDown={event => event.stopPropagation()}>
        <header className="desktop-settings-titlebar"><span><Settings2 size={15} /><strong id="desktop-settings-title">Settings</strong></span><button type="button" onClick={onClose} aria-label="Close settings" title="Close"><X size={15} /></button></header>
        <div className="desktop-settings-body">
          <SettingsNav active={activeSection} onSelect={setActiveSection} />
          <div className="desktop-settings-content">
            {activeSection === 'connections' && <ConnectionsSettings currentServerId={currentServerId} onClose={onClose} />}
            {activeSection === 'account' && <AccountSettings />}
            {activeSection === 'appearance' && <AppearanceSettings settings={desktopSettings} onChange={setDesktopSettings} />}
            {activeSection === 'terminal' && <TerminalSettingsPanel />}
            {activeSection === 'quake' && <QuakeSettingsPanel settings={desktopSettings} onChange={setDesktopSettings} />}
            {activeSection === 'shortcuts' && <ShortcutSettings settings={desktopSettings} onChange={setDesktopSettings} />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default memo(DesktopSettingsDialog)
