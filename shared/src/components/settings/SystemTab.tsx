import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, ExternalLink, Eye, EyeOff } from 'lucide-react'
import {
  isNativeApp,
  isWailsApp,
  haptic,
  getWebToken,
  getLocalTGentAccess,
  getLocalTGentPassword,
  type LocalTGentAccess,
} from '../../lib/platform'
import { removeHubOnlyServers } from '../../lib/localServers'
import { api, webApi, type AgentStatus, type UserInfo, type SubscriptionInfo } from '../../api/client'
import { useAppContext } from '../../contexts/AppContext'
import { eventBus } from '../../state/EventBus'
import Skeleton from '../Skeleton'
import AppUpdater from '../../plugins/appUpdater'
import ForegroundService from '../../plugins/foregroundService'
import { NativeConnection } from '../../plugins/nativeConnection'

export default function SystemTab() {
  const navigate = useNavigate()
  const { storeManager, authManager, foregroundServiceManager } = useAppContext()

  // 账号相关
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [userLoading, setUserLoading] = useState(false)
  const [hasWebToken, setHasWebToken] = useState(false)

  // 桌面本机 daemon
  const [localAccess, setLocalAccess] = useState<LocalTGentAccess | null>(null)
  const [localAccessLoading, setLocalAccessLoading] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [webPassword, setWebPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordCopied, setPasswordCopied] = useState(false)

  // 系统相关
  const [foregroundEnabled, setForegroundEnabled] = useState(false)
  const [deepEnabled, setDeepEnabled] = useState(false)
  const [showPermissionHint, setShowPermissionHint] = useState(false)

  // 连接层选择
  const [nativeConnectionEnabled, setNativeConnectionEnabled] = useState(() => {
    try {
      return localStorage.getItem('native_connection_enabled') !== 'false'
    } catch {
      return true
    }
  })
  const [showRestartHint, setShowRestartHint] = useState(false)

  // 版本信息
  const [appVersion, setAppVersion] = useState('')
  const [updateCheckState, setUpdateCheckState] = useState<'idle' | 'checking' | 'latest' | 'error'>('idle')

  useEffect(() => {
    getWebToken().then(t => setHasWebToken(!!t))
  }, [])

  useEffect(() => {
    if (!isWailsApp()) return

    let cancelled = false
    setLocalAccessLoading(true)
    getLocalTGentAccess()
      .then(access => {
        if (!cancelled) setLocalAccess(access)
      })
      .catch(() => {
        if (!cancelled) setLocalAccess(null)
      })
      .finally(() => {
        if (!cancelled) setLocalAccessLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!isNativeApp()) {
      api.agentStatus().then(setAgentStatus).catch(() => setAgentStatus(null))
    }
    if (hasWebToken) {
      setUserLoading(true)
      webApi.getMe()
        .then((resp) => { setUserInfo(resp.user); setSubscription(resp.subscription) })
        .catch(() => { setUserInfo(null); setSubscription(null) })
        .finally(() => setUserLoading(false))
    }
  }, [hasWebToken])

  useEffect(() => {
    if (isNativeApp()) {
      foregroundServiceManager.getEnabled()
        .then(setForegroundEnabled)
        .catch(() => {})

      foregroundServiceManager.getDeepEnabled()
        .then(setDeepEnabled)
        .catch(() => {})

      // Load version info
      AppUpdater.getAppVersion()
        .then(v => setAppVersion(v.versionName))
        .catch(() => {})
    }
  }, [foregroundServiceManager])

  useEffect(() => {
    if (!isNativeApp()) return

    let resetTimer: ReturnType<typeof setTimeout> | null = null
    const off = eventBus.on('update:result', ({ status }) => {
      if (resetTimer) {
        clearTimeout(resetTimer)
        resetTimer = null
      }

      if (status === 'latest') {
        setUpdateCheckState('latest')
        resetTimer = setTimeout(() => setUpdateCheckState('idle'), 2000)
        return
      }

      if (status === 'error') {
        setUpdateCheckState('error')
        resetTimer = setTimeout(() => setUpdateCheckState('idle'), 2000)
        return
      }

      setUpdateCheckState('idle')
    })

    return () => {
      off()
      if (resetTimer) clearTimeout(resetTimer)
    }
  }, [])

  const handleLogout = async () => {
    haptic()
    await authManager.logout()
    setUserInfo(null)
    setSubscription(null)
    setHasWebToken(false)
    storeManager.releaseHubStores()
    await removeHubOnlyServers()
    eventBus.emit('toast:show', { message: '已退出登录', type: 'success' })
    navigate('/', { replace: true })
  }

  const handleForegroundToggle = async () => {
    haptic()
    const next = !foregroundEnabled
    if (next) {
      // 开启时先弹提示，再请求权限
      setShowPermissionHint(true)
    } else {
      setForegroundEnabled(false)
      setDeepEnabled(false)
      await foregroundServiceManager.setDeepEnabled(false)
      await foregroundServiceManager.setEnabled(false)
    }
  }

  const handleDeepToggle = async () => {
    haptic()
    const next = !deepEnabled
    setDeepEnabled(next)
    await foregroundServiceManager.setDeepEnabled(next)
  }

  const handlePermissionConfirm = async () => {
    setShowPermissionHint(false)
    try {
      await ForegroundService.requestPermission()
    } catch {}
    setForegroundEnabled(true)
    await foregroundServiceManager.setEnabled(true)
  }

  const handlePermissionCancel = () => {
    setShowPermissionHint(false)
  }

  const handleNativeConnectionToggle = async () => {
    haptic()
    const next = !nativeConnectionEnabled
    setNativeConnectionEnabled(next)
    try {
      localStorage.setItem('native_connection_enabled', next ? 'true' : 'false')
    } catch {}
    // 同步到 Java SharedPreferences
    try {
      await NativeConnection.setEnabled({ enabled: next })
    } catch {}
    setShowRestartHint(true)
  }

  const handleCheckUpdate = async () => {
    haptic()
    setUpdateCheckState('checking')
    eventBus.emit('update:check', {})
  }

  const handleCopyWebPassword = async () => {
    haptic()
    setPasswordLoading(true)
    try {
      const password = webPassword || await getLocalTGentPassword()
      const desktopClipboard = (window as any).runtime?.ClipboardSetText
      if (desktopClipboard) {
        await desktopClipboard(password)
      } else {
        await navigator.clipboard.writeText(password)
      }
      setPasswordCopied(true)
      window.setTimeout(() => setPasswordCopied(false), 1800)
      eventBus.emit('toast:show', { message: 'Web 密码已复制', type: 'success' })
    } catch {
      eventBus.emit('toast:show', { message: '无法写入剪贴板', type: 'error' })
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleToggleWebPassword = async () => {
    haptic()
    if (passwordVisible) {
      setPasswordVisible(false)
      setWebPassword('')
      return
    }
    setPasswordLoading(true)
    try {
      const password = await getLocalTGentPassword()
      setWebPassword(password)
      setPasswordVisible(true)
    } catch {
      eventBus.emit('toast:show', { message: '无法读取 Web 密码', type: 'error' })
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleOpenSource = () => {
    haptic()
    const sourceURL = 'https://github.com/lozzo/tgent-client'
    const openExternal = (window as any).runtime?.BrowserOpenURL
    if (typeof openExternal === 'function') {
      openExternal(sourceURL)
      return
    }
    window.open(sourceURL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="space-y-6">
      {/* 账号 */}
      <div>
        <h3 className="text-sm font-medium text-t-secondary mb-3">账号</h3>
        <div className="rounded-xl bg-elevated border border-t-border p-4">
          {hasWebToken && userInfo ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-t-secondary">用户名</span>
                <span className="text-sm text-t-primary font-medium">{userInfo.username}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-t-secondary">邮箱</span>
                <span className="text-sm text-t-primary">{userInfo.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-t-secondary">订阅</span>
                {subscription?.active ? (
                  <div className="text-right">
                    <span className="text-sm text-green-400 font-medium">{subscription.planName}</span>
                    {subscription.currentPeriodEnd && (
                      <span className="text-xs text-t-muted ml-1.5">
                        到期 {new Date(subscription.currentPeriodEnd).toLocaleDateString('zh-CN')}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-t-muted">免费版</span>
                )}
              </div>
              <button
                onClick={handleLogout}
                className="w-full mt-2 py-2.5 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium active:bg-red-500/20 transition-colors"
              >
                退出登录
              </button>
            </div>
          ) : hasWebToken && userLoading ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-t-secondary">用户名</span>
                <Skeleton width={80} height={16} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-t-secondary">邮箱</span>
                <Skeleton width={120} height={16} />
              </div>
              <button
                onClick={handleLogout}
                className="w-full mt-2 py-2.5 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium active:bg-red-500/20 transition-colors"
              >
                退出登录
              </button>
            </div>
          ) : hasWebToken ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-t-secondary">用户名</span>
                <span className="text-sm text-t-muted">获取失败</span>
              </div>
              <button
                onClick={handleLogout}
                className="w-full py-2.5 rounded-lg bg-red-500/10 text-red-400 text-sm font-medium active:bg-red-500/20 transition-colors"
              >
                退出登录
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-t-muted">未登录</p>
              <button
                onClick={() => navigate('/login')}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 transition-colors"
              >
                登录
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Wails 桌面端与本机 daemon 的访问方式 */}
      {isWailsApp() && (
        <div>
          <h3 className="text-sm font-medium text-t-secondary mb-3">本机 TGent</h3>
          <div className="rounded-xl bg-elevated border border-t-border p-4">
            {localAccessLoading ? (
              <div className="space-y-3">
                <Skeleton width="100%" height={18} />
                <Skeleton width="72%" height={18} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-t-secondary">本机连接</span>
                  <span className="inline-flex items-center gap-2 text-sm text-t-primary">
                    <span className={`h-1.5 w-1.5 rounded-full ${localAccess?.found ? 'bg-emerald-400' : 'bg-[var(--color-text-muted)]'}`} />
                    {localAccess?.socketAvailable
                      ? '本地 Socket'
                      : localAccess?.found
                        ? 'HTTP 兼容模式'
                        : '未运行'}
                  </span>
                </div>

                {localAccess?.address && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-t-secondary">Web 地址</span>
                    <span className="min-w-0 truncate text-sm text-t-primary font-mono">{localAccess.address}</span>
                  </div>
                )}

                <div className="border-t border-t-border pt-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-t-secondary">Web 密码</span>
                    {localAccess?.passwordAvailable ? (
                      <div className="flex min-w-0 items-center gap-1.5">
                        <code className="max-w-[220px] truncate text-sm text-t-primary">
                          {passwordVisible ? webPassword : '••••••••••••'}
                        </code>
                        <button
                          type="button"
                          onClick={handleToggleWebPassword}
                          disabled={passwordLoading}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-t-muted transition-colors hover:bg-white/5 hover:text-t-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
                          aria-label={passwordVisible ? '隐藏 Web 密码' : '查看 Web 密码'}
                          title={passwordVisible ? '隐藏 Web 密码' : '查看 Web 密码'}
                        >
                          {passwordVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyWebPassword}
                          disabled={passwordLoading}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-t-muted transition-colors hover:bg-white/5 hover:text-t-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-40"
                          aria-label="复制 Web 密码"
                          title="复制 Web 密码"
                        >
                          {passwordCopied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-t-muted">
                        {localAccess?.authEnabled ? '无法读取' : '未启用'}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-t-muted">
                    桌面端连接本机时不使用此密码；浏览器和局域网连接仍需验证。
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent 连接状态（仅 Web 模式） */}
      {!isNativeApp() && (
        <div>
          <h3 className="text-sm font-medium text-t-secondary mb-3">Agent 连接状态</h3>
          <div className="rounded-xl bg-elevated border border-t-border p-4 space-y-2">
            {agentStatus === null ? (
              <p className="text-sm text-t-muted">加载中...</p>
            ) : !agentStatus.enabled ? (
              <p className="text-sm text-t-muted">未启用 Agent 模式（daemon 未配置 --hub-addr）</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-t-secondary">Hub</span>
                  <span className="text-sm text-t-primary font-mono">{agentStatus.hub_addr}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-t-secondary">状态</span>
                  <span className={`text-sm font-medium ${agentStatus.connected ? 'text-green-400' : 'text-red-400'}`}>
                    {agentStatus.connected ? '已连接' : '未连接'}
                  </span>
                </div>
                {agentStatus.agent_id && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-t-secondary">Agent ID</span>
                    <span className="text-sm text-t-primary font-mono truncate ml-4">{agentStatus.agent_id}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 后台保活 */}
      {isNativeApp() && (
        <div>
          <h3 className="text-sm font-medium text-t-secondary mb-3">后台保活</h3>
          <div className="rounded-xl bg-elevated border border-t-border p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 mr-3">
                <span className="text-sm text-t-primary">保持后台连接</span>
                <p className="text-xs text-t-muted mt-0.5">保持终端连接在后台不被系统中断</p>
              </div>
              <button
                onClick={handleForegroundToggle}
                className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${
                  foregroundEnabled ? 'bg-blue-600' : 'bg-[var(--color-text-muted)]'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  foregroundEnabled ? 'left-[22px]' : 'left-0.5'
                }`} />
              </button>
            </div>
            {foregroundEnabled && (
              <div className="mt-3 pt-3 border-t border-t-border">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 mr-3">
                    <span className="text-sm text-t-primary">深度保活</span>
                    <p className="text-xs text-yellow-500/80 mt-0.5">始终保持 CPU 和 WiFi 活跃，长时间锁屏、文件传输或厂商省电策略激进时更稳，但会增加电量消耗</p>
                  </div>
                  <button
                    onClick={handleDeepToggle}
                    className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${
                      deepEnabled ? 'bg-blue-600' : 'bg-[var(--color-text-muted)]'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      deepEnabled ? 'left-[22px]' : 'left-0.5'
                    }`} />
                  </button>
                </div>
                {!deepEnabled && (
                  <p className="text-xs text-t-muted mt-2">普通后台保活已会在锁屏时临时加强；如果仍会断开，再开启这个选项</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 通知权限提示弹窗 */}
      {showPermissionHint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-elevated border border-t-border p-5 space-y-4">
            <h3 className="text-base font-medium text-t-primary">需要通知权限</h3>
            <p className="text-sm text-t-secondary leading-relaxed">
              后台保活需要通过通知栏保持服务运行，请在接下来的系统弹窗中点击「允许」，否则连接可能在后台被系统中断。
            </p>
            <div className="flex gap-3">
              <button
                onClick={handlePermissionCancel}
                className="flex-1 py-2.5 rounded-lg bg-[var(--color-text-muted)]/20 text-t-secondary text-sm font-medium active:opacity-70 transition-opacity"
              >
                取消
              </button>
              <button
                onClick={handlePermissionConfirm}
                className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 transition-colors"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 连接层（仅 Native App） */}
      {isNativeApp() && (
        <div>
          <h3 className="text-sm font-medium text-t-secondary mb-3">连接层</h3>
          <div className="rounded-xl bg-elevated border border-t-border p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 mr-3">
                <span className="text-sm text-t-primary">使用 Native 连接</span>
                <p className="text-xs text-t-muted mt-0.5">默认开启，关闭后使用备用连接，切换后需重启 App</p>
              </div>
              <button
                onClick={handleNativeConnectionToggle}
                className={`w-11 h-6 rounded-full relative transition-colors shrink-0 ${
                  nativeConnectionEnabled ? 'bg-blue-600' : 'bg-[var(--color-text-muted)]'
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  nativeConnectionEnabled ? 'left-[22px]' : 'left-0.5'
                }`} />
              </button>
            </div>
            {showRestartHint && (
              <p className="text-xs text-yellow-500/80 mt-2">已切换，重启 App 后生效</p>
            )}
          </div>
        </div>
      )}

      {/* 版本信息 */}
      {isNativeApp() && (
        <div>
          <h3 className="text-sm font-medium text-t-secondary mb-3">版本信息</h3>
          <div className="rounded-xl bg-elevated border border-t-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-t-secondary">App 版本</span>
              <span className="text-sm text-t-primary font-mono">{appVersion || '-'}</span>
            </div>
            <button
              onClick={handleCheckUpdate}
              disabled={updateCheckState === 'checking'}
              className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {updateCheckState === 'checking'
                ? '检查中...'
                : updateCheckState === 'latest'
                  ? '已是最新版本'
                  : updateCheckState === 'error'
                    ? '检查失败'
                    : '检查更新'}
            </button>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-t-secondary mb-3">开源许可</h3>
        <button
          type="button"
          onClick={handleOpenSource}
          className="w-full rounded-xl bg-elevated border border-t-border p-4 flex items-center justify-between text-left active:opacity-70 transition-opacity"
        >
          <div className="min-w-0 mr-3">
            <span className="text-sm text-t-primary">源代码与许可</span>
            <p className="text-xs text-t-muted mt-0.5">GNU AGPL v3.0 only</p>
          </div>
          <ExternalLink size={17} className="text-t-muted shrink-0" aria-hidden="true" />
        </button>
      </div>

    </div>
  )
}
