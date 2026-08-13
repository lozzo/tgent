import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { webApi } from '../api/client'
import { setWebToken, getWebUrl, setWebUrl, clearWebUrl, isCustomWebUrl, setWebRefreshToken } from '../lib/platform'
import { translateError } from '../lib/errors'
import PasswordInput from './PasswordInput'
import { useAppBack } from '../hooks/useAppBack'
import { useAppContext } from '../contexts/AppContext'
import { eventBus } from '../state/EventBus'

interface AuthFormProps {
  mode: 'login' | 'register'
}

export default function AuthForm({ mode }: AuthFormProps) {
  const isLogin = mode === 'login'
  const navigate = useNavigate()
  const location = useLocation()
  const { storeManager } = useAppContext()
  const returnTo = isLogin ? ((location.state as { returnTo?: string })?.returnTo || '/') : '/'
  useAppBack('/')

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [webUrlInput, setWebUrlInput] = useState('')

  useEffect(() => {
    if (!isLogin) return
    ;(async () => {
      const custom = await isCustomWebUrl()
      if (custom) {
        setWebUrlInput(await getWebUrl())
      }
    })()
  }, [isLogin])

  const formValid = isLogin
    ? username.trim().length > 0 && password.length > 0
    : username.trim().length > 0 && email.trim().length > 0 && password.length > 0 && confirmPassword.length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formValid) return

    if (!isLogin) {
      if (password !== confirmPassword) {
        setError('两次密码输入不一致')
        return
      }
      if (password.length < 6) {
        setError('密码至少 6 个字符')
        return
      }
    }

    if (isLogin) {
      const currentWebUrl = await getWebUrl()
      const trimmedUrl = webUrlInput.trim().replace(/\/+$/, '')
      if (trimmedUrl) {
        if (trimmedUrl !== currentWebUrl) {
          await setWebUrl(trimmedUrl)
          storeManager.releaseAllStores()
        }
      } else if (await isCustomWebUrl()) {
        await clearWebUrl()
        storeManager.releaseAllStores()
      }
    }

    setLoading(true)
    setError('')
    try {
      const resp = isLogin
        ? await webApi.login(username.trim(), password)
        : await webApi.register(username.trim(), email.trim(), password)
      await setWebToken(resp.token)
      await setWebRefreshToken(resp.refresh_token)
      eventBus.emit('auth:login', {})
      if (isLogin) {
        eventBus.emit('toast:show', { message: '登录成功', type: 'success', duration: 2000 })
      }
      navigate(returnTo, { replace: true })
    } catch (err) {
      const msg = (err as Error).message
      const translated = translateError(msg)
      eventBus.emit('toast:show', { message: translated, type: 'error' })
      setError(msg === 'Failed to fetch' ? `${translated} (${await getWebUrl()})` : translated)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-page flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-t-primary">{isLogin ? 'tgent' : '注册 tgent'}</h1>
          {isLogin && <p className="text-t-muted text-sm mt-1">Multi-Server Management</p>}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
            />
          </div>
          {!isLogin && (
            <div>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="邮箱"
                autoComplete="email"
                className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
          <div>
            <PasswordInput
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isLogin ? '密码' : '密码（至少 6 位）'}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
            />
          </div>
          {!isLogin && (
            <div>
              <PasswordInput
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="确认密码"
                autoComplete="new-password"
                className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !formValid}
            className={`w-full py-3 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-50 active:bg-blue-700 transition-colors${isLogin ? ' flex items-center justify-center gap-2' : ''}`}
          >
            {isLogin && loading && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading
              ? (isLogin ? '登录中...' : '注册中...')
              : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        <p className="text-center text-t-muted text-sm mt-6">
          {isLogin ? '没有账号？' : '已有账号？'}
          <Link to={isLogin ? '/register' : '/login'} className="text-blue-400 ml-1">
            {isLogin ? '注册' : '登录'}
          </Link>
        </p>
      </div>
    </div>
  )
}
