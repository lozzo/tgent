import { useState, useEffect } from 'react'
import Dashboard from './Dashboard'
import { api } from '../api/client'
import { translateError } from '../lib/errors'
import PasswordInput from '../components/PasswordInput'
import { storage } from '../lib/storage'

export default function DirectAuthPage() {
  const [auth, setAuth] = useState<'checking' | 'ok' | 'need_login'>('checking')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)

  useEffect(() => {
    ;(async () => {
      const token = await storage.get('tgent_token')
      fetch('/api/v1/status', {
        headers: {
          'Authorization': `Bearer ${token || ''}`,
        },
      }).then(resp => {
        setAuth(resp.status === 401 ? 'need_login' : 'ok')
      }).catch(() => setAuth('need_login'))
    })()
  }, [])

  if (auth === 'checking') {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <span className="text-t-muted text-sm">连接中...</span>
      </div>
    )
  }

  if (auth === 'need_login') {
    const handleLogin = async (e: React.FormEvent) => {
      e.preventDefault()
      if (!password) return
      setLogging(true)
      setError('')
      try {
        const resp = await api.login(password)
        await storage.set('tgent_token', resp.token)
        setAuth('ok')
      } catch (err) {
        setError(translateError((err as Error).message))
      } finally {
        setLogging(false)
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
            <h1 className="text-2xl font-bold text-t-primary">tgent</h1>
            <p className="text-t-muted text-sm mt-1">请输入 daemon 密码</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <PasswordInput
              autoFocus
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              placeholder="密码"
              className="w-full px-4 py-3 rounded-xl bg-elevated border border-t-border text-t-primary placeholder-t-muted focus:outline-none focus:border-blue-500"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={logging || !password}
              className="w-full py-3 rounded-xl bg-blue-600 text-white font-medium disabled:opacity-50 active:bg-blue-700 transition-colors"
            >
              {logging ? '登录中...' : '登录'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return <Dashboard />
}
