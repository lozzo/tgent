import { useEffect, useState } from 'react'
import { addOrUpdateByHubAgentId, type LocalServer } from '../lib/localServers'
import { haptic, isWailsApp, validateLocalTGent } from '../lib/platform'
import { translateError } from '../lib/errors'
import PasswordInput from './PasswordInput'

interface Props {
  open: boolean
  onClose: () => void
  onAdded: (server: LocalServer) => void
  initialAddr?: string
  initialName?: string
  localDiscovery?: boolean
}

export default function AddLocalServerDialog({
  open,
  onClose,
  onAdded,
  initialAddr = '',
  initialName = '',
  localDiscovery = false,
}: Props) {
  const [addr, setAddr] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const desktop = isWailsApp()

  useEffect(() => {
    if (!open) return
    setAddr(initialAddr)
    setName(initialName)
    setPassword('')
    setError('')
  }, [open, initialAddr, initialName])

  if (!open) return null

  const handleTest = async () => {
    const trimmedAddr = addr.trim().replace(/\/+$/, '')
    if (!trimmedAddr) {
      setError('请输入服务器地址')
      return
    }

    haptic()
    setTesting(true)
    setError('')

    try {
      if (desktop) {
        const validation = await validateLocalTGent(trimmedAddr, password)
        if (!validation.ok) {
          const message = validation.requiresPassword
            ? '此 daemon 需要密码，请在下方填写'
            : validation.error === 'invalid_password'
              ? 'daemon 密码错误'
              : validation.error === 'invalid_address'
                ? '请输入有效的 HTTP 地址'
                : validation.error === 'not_tgent'
                  ? '该地址不是 TGent daemon'
                  : '无法连接到 TGent daemon'
          setError(message)
          return
        }
      } else if (password) {
        // 填了密码，直接登录验证
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const loginResp = await fetch(`${trimmedAddr}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!loginResp.ok) {
          setError('密码错误')
          setTesting(false)
          return
        }
      } else {
        // 没填密码，先探测 status
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)
        const resp = await fetch(`${trimmedAddr}/api/v1/status`, {
          signal: controller.signal,
        })
        clearTimeout(timeout)
        if (resp.status === 401) {
          setError('此服务器需要密码，请在上方填写')
          setTesting(false)
          return
        }
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`)
        }
      }

      // 连接成功，添加服务器
      const serverName = name.trim() || trimmedAddr.replace(/^https?:\/\//, '').split(':')[0]
      const server = await addOrUpdateByHubAgentId({ name: serverName, addr: trimmedAddr, password })

      // 重置表单
      setAddr('')
      setName('')
      setPassword('')
      setError('')
      onAdded(server)
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setError('连接超时，请检查地址和网络')
      } else {
        setError(`连接失败: ${translateError(e.message)}`)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleClose = () => {
    setAddr('')
    setName('')
    setPassword('')
    setError('')
    onClose()
  }

  return (
    <div className={`fixed inset-0 z-50 flex justify-center ${desktop ? 'items-center p-6' : 'items-end'}`} onClick={handleClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className={`relative w-full bg-surface px-5 ${
          desktop
            ? 'max-w-md rounded-lg border border-t-border-subtle py-5 shadow-2xl'
            : 'max-w-lg rounded-t-3xl pt-4 pb-8 animate-slide-up'
        }`}
        onClick={e => e.stopPropagation()}
        style={desktop ? undefined : { paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        {!desktop && <div className="w-10 h-1 rounded-full bg-t-border mx-auto mb-5" />}
        <h3 className="text-t-primary text-[18px] font-semibold mb-1">
          {localDiscovery ? '连接本机 TGent' : '添加服务器'}
        </h3>
        {localDiscovery && (
          <p className="text-t-muted text-sm mb-4">
            已发现 <span className="text-t-secondary">{name || '本机 TGent'}</span>
            <span className="mx-1.5 text-t-muted">·</span>
            {addr.replace(/^https?:\/\//, '')}。输入 daemon 密码即可连接，无需登录账号。
          </p>
        )}

        <div className="space-y-3">
          {!localDiscovery && (
            <>
              <div>
                <label className="text-sm text-t-secondary block mb-1.5">服务器地址</label>
                <input
                  autoFocus
                  type="url"
                  value={addr}
                  onChange={(e) => { setAddr(e.target.value); setError('') }}
                  placeholder="http://192.168.1.100:8080"
                  className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleTest()}
                />
              </div>

              <div>
                <label className="text-sm text-t-secondary block mb-1.5">名称（可选）</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="自动使用主机名"
                  className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="text-sm text-t-secondary block mb-1.5">
              {localDiscovery ? 'daemon 密码' : '密码（可选）'}
            </label>
            <PasswordInput
              autoFocus={localDiscovery}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError('') }}
              placeholder="输入 daemon 密码"
              className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && handleTest()}
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleTest}
            disabled={testing || !addr.trim()}
            className="w-full py-3.5 bg-blue-600 active:bg-blue-700 disabled:bg-elevated disabled:text-t-muted rounded-xl text-[17px] text-white font-semibold transition-colors"
          >
            {testing ? '连接中...' : localDiscovery ? '连接本机' : '测试并添加'}
          </button>
        </div>
      </div>
    </div>
  )
}
