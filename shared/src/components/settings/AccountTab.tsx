import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { haptic, getWebToken, isNativeApp } from '../../lib/platform'
import { removeHubOnlyServers } from '../../lib/localServers'
import { api, webApi, type AgentStatus, type UserInfo } from '../../api/client'
import { useAppContext } from '../../contexts/AppContext'
import { eventBus } from '../../state/EventBus'
import Skeleton from '../Skeleton'

export default function AccountTab() {
  const { storeManager, authManager } = useAppContext()
  const navigate = useNavigate()

  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [userLoading, setUserLoading] = useState(false)
  const [hasWebToken, setHasWebToken] = useState(false)

  useEffect(() => {
    getWebToken().then(t => setHasWebToken(!!t))
  }, [])

  useEffect(() => {
    if (!isNativeApp()) {
      api.agentStatus().then(setAgentStatus).catch(() => setAgentStatus(null))
    }
    if (hasWebToken) {
      setUserLoading(true)
      webApi.getMe()
        .then((resp) => setUserInfo(resp.user))
        .catch(() => setUserInfo(null))
        .finally(() => setUserLoading(false))
    }
  }, [hasWebToken])

  const handleLogout = async () => {
    haptic()
    await authManager.logout()
    setUserInfo(null)
    setHasWebToken(false)
    storeManager.releaseHubStores()
    await removeHubOnlyServers()
    eventBus.emit('toast:show', { message: '已退出登录', type: 'success' })
    navigate('/', { replace: true })
  }

  return (
    <div className="space-y-6">
      {/* 登录状态 */}
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
                onClick={() => { haptic(); navigate('/login') }}
                className="w-full py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 transition-colors"
              >
                登录
              </button>
            </div>
          )}
        </div>
      </div>

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
    </div>
  )
}
