import { useState } from 'react'
import type { TransferInfo } from '../../types/files'
import { haptic } from '../../lib/platform'

interface Props {
  transfers: TransferInfo[]
  hasActiveTransfers: boolean
  onCancel: (id: string) => void
  onDismiss: (id: string) => void
  onRetry: (id: string) => void
}

function formatSpeed(bytes: number, startedAt: number): string {
  const elapsed = (Date.now() - startedAt) / 1000
  if (elapsed <= 0) return ''
  const speed = bytes / elapsed
  if (speed < 1024) return `${Math.round(speed)} B/s`
  if (speed < 1024 * 1024) return `${(speed / 1024).toFixed(1)} KB/s`
  return `${(speed / (1024 * 1024)).toFixed(1)} MB/s`
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function FileTransferPanel({ transfers, hasActiveTransfers, onCancel, onDismiss, onRetry }: Props) {
  const active = transfers.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
  const [collapsed, setCollapsed] = useState(false)

  if (active.length === 0) return null

  const transferringCount = active.filter(t => t.status === 'pending' || t.status === 'transferring').length
  const failedCount = active.filter(t => t.status === 'failed').length
  const summaryParts: string[] = []
  if (transferringCount > 0) summaryParts.push(`传输中 ${transferringCount}`)
  if (failedCount > 0) summaryParts.push(`失败 ${failedCount}`)
  const summary = summaryParts.join(' · ') || `${active.length} 项`

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 safe-bottom">
      <div className="max-w-lg mx-auto px-4 pb-4">
        <div className="bg-[var(--color-bg-card,#1c1c1e)] rounded-2xl border border-[var(--color-border-subtle)] shadow-lg overflow-hidden">
          {/* 头部（可点击收起/展开） */}
          <button
            onClick={() => { haptic(); setCollapsed(c => !c) }}
            className="w-full px-4 py-2.5 border-b border-[var(--color-border-subtle)] text-left"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-t-secondary">
                {summary}
              </span>
              <svg
                className={`w-4 h-4 text-t-muted transition-transform duration-200 ${collapsed ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
            {/* 传输中请勿退出 APP 提示 */}
            {hasActiveTransfers && !collapsed && (
              <p className="text-[11px] text-yellow-400/80 mt-1">
                传输进行中，请勿退出 APP 或切换到后台
              </p>
            )}
          </button>
          {/* 详细列表（收起时隐藏） */}
          {!collapsed && (
            <div className="max-h-[200px] overflow-y-auto">
              {active.map(t => {
                const progress = t.totalSize > 0 ? (t.transferredSize / t.totalSize) * 100 : 0
                const isFailed = t.status === 'failed'
                const canRetry = isFailed && (
                  (t.direction === 'download' && t.filePath) ||
                  (t.direction === 'upload' && t.file && t.targetDir)
                )
                return (
                  <div key={t.id} className="px-4 py-3 border-b border-[var(--color-border-subtle)] last:border-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs text-t-muted shrink-0">
                          {t.direction === 'download' ? '↓' : '↑'}
                        </span>
                        <span className="text-sm text-t-primary truncate">{t.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {(t.status === 'pending' || t.status === 'transferring') && (
                          <button
                            onClick={() => { haptic(); onCancel(t.id) }}
                            className="text-t-muted hover:text-red-400 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                        {isFailed && (
                          <>
                            {canRetry && (
                              <button
                                onClick={() => { haptic(); onRetry(t.id) }}
                                className="text-t-muted hover:text-blue-400 transition-colors"
                                title="重试"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => { haptic(); onDismiss(t.id) }}
                              className="text-t-muted hover:text-red-400 transition-colors"
                              title="关闭"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="h-1.5 bg-[var(--color-border-subtle)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-colors duration-200 ${
                          isFailed ? 'bg-red-400' : 'bg-blue-400'
                        }`}
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-t-muted">
                        {isFailed ? (
                          <span className="text-red-400">失败</span>
                        ) : (
                          `${formatSize(t.transferredSize)} / ${formatSize(t.totalSize)}`
                        )}
                      </span>
                      {t.status === 'transferring' && (
                        <span className="text-[11px] text-t-muted">
                          {formatSpeed(t.transferredSize, t.startedAt)}
                        </span>
                      )}
                    </div>
                    {t.error && (
                      <p className="text-xs text-red-400 mt-1 truncate">{t.error}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
