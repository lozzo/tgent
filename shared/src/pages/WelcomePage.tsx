import { useNavigate } from 'react-router-dom'
import { isNativeApp, haptic } from '../lib/platform'

export default function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center px-6 safe-x safe-top safe-bottom">
      <div className="w-20 h-20 rounded-3xl bg-blue-500/15 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-t-primary mb-2">tgent</h1>
      <p className="text-t-secondary text-center mb-10">tmux 终端管理，随时随地</p>

      <div className="w-full max-w-sm space-y-3">
        {isNativeApp() && (
          <button
            onClick={() => { haptic(); navigate('/scan', { replace: true }) }}
            className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-medium active:bg-blue-700 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
            </svg>
            扫码添加服务器
          </button>
        )}

        <button
          onClick={() => { haptic(); navigate('/?action=add', { replace: true }) }}
          className="w-full py-3.5 rounded-xl bg-elevated border border-t-border text-t-primary font-medium active:bg-[var(--color-border)] transition-colors"
        >
          手动添加
        </button>

        <button
          onClick={() => { haptic(); navigate('/', { replace: true }) }}
          className="w-full py-3 text-t-muted text-sm active:text-t-secondary transition-colors"
        >
          跳过
        </button>
      </div>
    </div>
  )
}
