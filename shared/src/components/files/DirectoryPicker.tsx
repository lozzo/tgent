import { useState, useEffect, useCallback } from 'react'
import type { WebRTCTransport } from '../../api/transport'
import { createFileApi } from '../../api/fileClient'
import type { FileEntry } from '../../types/files'
import { haptic } from '../../lib/platform'

interface Props {
  transport: WebRTCTransport
  isOpen: boolean
  onSelect: (path: string) => void
  onCancel: () => void
  initialPath?: string
}

export default function DirectoryPicker({ transport, isOpen, onSelect, onCancel, initialPath }: Props) {
  const [currentPath, setCurrentPath] = useState(initialPath || '/')
  const [dirs, setDirs] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadDirs = useCallback(async (path: string) => {
    setLoading(true)
    setError('')
    try {
      const fileApi = createFileApi(transport)
      const resp = await fileApi.listDir(path, 0, 500)
      setDirs(resp.entries.filter(e => e.type === 'dir' || e.type === 'symlink-dir'))
      setCurrentPath(resp.path || path)
    } catch (e) {
      setError((e as Error).message)
      setDirs([])
    } finally {
      setLoading(false)
    }
  }, [transport])

  useEffect(() => {
    if (isOpen) {
      loadDirs(initialPath || '/')
    }
  }, [isOpen, initialPath, loadDirs])

  if (!isOpen) return null

  const navigateTo = (path: string) => {
    haptic()
    loadDirs(path)
  }

  const goUp = () => {
    if (currentPath === '/') return
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/'
    navigateTo(parent)
  }

  // 面包屑段
  const segments = currentPath === '/'
    ? ['/']
    : ['/', ...currentPath.split('/').filter(Boolean)]

  const sortedDirs = [...dirs].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-page safe-x">
      {/* Header */}
      <header className="shrink-0 bg-page/80 backdrop-blur-xl border-b border-t-border-subtle safe-top">
        <div className="px-4 pt-3 pb-2.5 flex items-center justify-between">
          <button onClick={() => { haptic(); onCancel() }} className="text-[16px] text-t-secondary active:opacity-70">
            取消
          </button>
          <h3 className="text-[17px] font-semibold text-t-primary">选择目录</h3>
          <div className="w-10" />
        </div>
      </header>

      {/* 面包屑 */}
      <div className="px-4 py-2 border-b border-t-border-subtle overflow-x-auto">
        <div className="flex items-center gap-1 text-[13px] whitespace-nowrap">
          {segments.map((seg, i) => {
            const path = seg === '/'
              ? '/'
              : '/' + segments.slice(1, i + 1).join('/')
            const isLast = i === segments.length - 1
            return (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-t-muted">/</span>}
                <button
                  onClick={() => navigateTo(path)}
                  className={`px-1 py-0.5 rounded ${isLast ? 'text-t-primary font-medium' : 'text-blue-500 active:opacity-70'}`}
                >
                  {seg === '/' ? '~' : seg}
                </button>
              </span>
            )
          })}
        </div>
      </div>

      {/* 目录列表 */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="px-4 py-3 mx-4 mt-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-0.5 p-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-[var(--color-border-subtle)] shrink-0" />
                <div className="flex-1 h-4 w-2/3 rounded bg-[var(--color-border-subtle)]" />
              </div>
            ))}
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {/* 上级目录 */}
            {currentPath !== '/' && (
              <div
                className="flex items-center gap-3.5 px-4 py-3 rounded-xl active:bg-[var(--color-border-subtle)] cursor-pointer"
                onClick={goUp}
              >
                <div className="w-10 h-10 rounded-xl bg-[var(--color-border-subtle)] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                  </svg>
                </div>
                <span className="text-[15px] text-t-secondary">..</span>
              </div>
            )}

            {sortedDirs.map(dir => {
              const fullPath = currentPath === '/'
                ? '/' + dir.name
                : currentPath + '/' + dir.name
              return (
                <div
                  key={dir.name}
                  className="flex items-center gap-3.5 px-4 py-3 rounded-xl active:bg-[var(--color-border-subtle)] cursor-pointer"
                  onClick={() => navigateTo(fullPath)}
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  </div>
                  <span className={`text-[15px] truncate ${dir.name.startsWith('.') ? 'text-t-muted' : 'text-t-primary'}`}>
                    {dir.name}
                  </span>
                  <svg className="w-4 h-4 text-t-muted shrink-0 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M6.293 4.293a1 1 0 011.414 0L14 10.586l-6.293 6.293a1 1 0 01-1.414-1.414L11.172 10.5 6.293 5.707a1 1 0 010-1.414z" />
                  </svg>
                </div>
              )
            })}

            {sortedDirs.length === 0 && !loading && !error && (
              <div className="text-center py-12 text-t-muted text-sm">
                此目录下没有子目录
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部选择按钮 */}
      <div className="shrink-0 border-t border-t-border-subtle bg-page/80 backdrop-blur-xl px-4 pt-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        <div className="text-[13px] text-t-muted mb-2 truncate">
          {currentPath}
        </div>
        <button
          onClick={() => { haptic(); onSelect(currentPath) }}
          className="w-full py-3.5 bg-blue-600 active:bg-blue-700 rounded-xl text-[17px] text-white font-semibold transition-colors"
        >
          选择此目录
        </button>
      </div>
    </div>
  )
}
