import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { WebRTCTransport } from '../../api/transport'
import type { TransferProps } from '../../hooks/useFileManager'
import type { TransferInfo } from '../../types/files'
import { haptic } from '../../lib/platform'
import ActionSheet from '../common/ActionSheet'
import FileManager, { type FileManagerHandle } from './FileManager'
import FileTransferPanel from './FileTransferPanel'
import PathBookmarkPanel from './PathBookmarkPanel'

interface Props {
  open: boolean
  transport?: WebRTCTransport
  initialPath: string
  contextKey: string
  isRelay: boolean
  allowRelayTransfer: boolean
  disconnected: boolean
  reconnecting: boolean
  statusText: string
  serverId?: string
  transferProps: TransferProps
  transfers: TransferInfo[]
  hasActiveTransfers: boolean
  onCancelTransfer: (id: string) => void
  onDismissTransfer: (id: string) => void
  onRetryTransfer: (id: string) => void
  onClose: () => void
}

export interface TerminalFileDrawerHandle {
  handleBack: () => boolean
  refresh: () => void
}

const TerminalFileDrawer = forwardRef<TerminalFileDrawerHandle, Props>(function TerminalFileDrawer({
  open,
  transport,
  initialPath,
  contextKey,
  isRelay,
  allowRelayTransfer,
  disconnected,
  reconnecting,
  statusText,
  serverId,
  transferProps,
  transfers,
  hasActiveTransfers,
  onCancelTransfer,
  onDismissTransfer,
  onRetryTransfer,
  onClose,
}, ref) {
  const fileManagerRef = useRef<FileManagerHandle>(null)
  const [hasOpened, setHasOpened] = useState(open)
  const [selectionMode, setSelectionMode] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false)

  useEffect(() => {
    if (open) setHasOpened(true)
    else {
      setShowMore(false)
      setBookmarkPanelOpen(false)
    }
  }, [open])

  useImperativeHandle(ref, () => ({
    handleBack: () => {
      if (showMore) {
        setShowMore(false)
        return true
      }
      if (bookmarkPanelOpen) {
        setBookmarkPanelOpen(false)
        return true
      }
      return fileManagerRef.current?.handleBack() ?? false
    },
    refresh: () => fileManagerRef.current?.refresh(),
  }), [bookmarkPanelOpen, showMore])

  const actions = useMemo(() => [
    {
      label: '上传文件',
      disabled: fileManagerRef.current?.isRelayNoTransfer,
      disabledLabel: '上传文件（中转不可用）',
      onPress: () => setTimeout(() => fileManagerRef.current?.triggerUpload(), 50),
    },
    {
      label: '新建目录',
      onPress: () => setTimeout(() => fileManagerRef.current?.triggerNewDir(), 50),
    },
    {
      label: fileManagerRef.current?.showHidden ? '隐藏隐藏文件' : '显示隐藏文件',
      onPress: () => fileManagerRef.current?.toggleShowHidden(),
    },
    {
      label: '刷新目录',
      onPress: () => fileManagerRef.current?.refresh(),
    },
  ], [showMore])

  return (
    <section
      aria-label="文件管理"
      aria-hidden={!open}
      className={`absolute inset-0 z-[60] flex flex-col bg-page shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none md:left-auto md:w-[460px] md:border-l md:border-t-border ${
        open ? 'translate-x-0 pointer-events-auto' : 'translate-x-full pointer-events-none'
      }`}
    >
      <header className="shrink-0 safe-top safe-x bg-page/95 backdrop-blur-xl border-b border-t-border-subtle">
        <div className="h-[52px] px-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <svg className="w-5 h-5 shrink-0 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 0 1 6 4.5h3.129c.597 0 1.169.237 1.591.659l1.121 1.121c.422.422.994.659 1.591.659H18A2.25 2.25 0 0 1 20.25 9.19v7.56A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25v-10Z" />
            </svg>
            <h2 className="truncate text-[16px] font-semibold text-t-primary">文件</h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {!selectionMode && serverId && (
              <button
                type="button"
                onClick={() => { haptic(); setBookmarkPanelOpen(true) }}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-yellow-500 active:bg-[var(--color-border-subtle)]"
                aria-label="路径收藏"
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
              </button>
            )}
            {!selectionMode && (
              <button
                type="button"
                onClick={() => { haptic(); fileManagerRef.current?.enterSelectionMode() }}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-blue-400 active:bg-[var(--color-border-subtle)]"
                aria-label="多选"
              >
                <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m9 12.75 2.25 2.25L15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
              </button>
            )}
            {!selectionMode && (
              <button
                type="button"
                onClick={() => { haptic(); setShowMore(true) }}
                className="w-9 h-9 flex items-center justify-center rounded-lg text-t-secondary active:bg-[var(--color-border-subtle)]"
                aria-label="更多操作"
              >
                <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => { haptic(); onClose() }}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-t-secondary active:bg-[var(--color-border-subtle)]"
              aria-label="关闭文件管理"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain">
        {hasOpened && transport && (
          <main className="max-w-lg mx-auto px-2 sm:px-4">
            <FileManager
              key={contextKey}
              ref={fileManagerRef}
              transport={transport}
              isRelay={isRelay}
              allowRelayTransfer={allowRelayTransfer}
              initialPath={initialPath}
              onSelectionModeChange={setSelectionMode}
              transferProps={transferProps}
            />
          </main>
        )}
        {hasOpened && !transport && !disconnected && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-t-muted">正在准备文件通道...</div>
        )}
        {disconnected && (
          <div className="absolute inset-0 z-10 bg-page/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              {reconnecting && (
                <svg className="w-5 h-5 text-yellow-400 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z" />
                </svg>
              )}
              <p className="text-sm text-t-muted">{reconnecting ? (statusText || '正在重连...') : '连接已断开'}</p>
            </div>
          </div>
        )}
      </div>

      {open && (
        <FileTransferPanel
          transfers={transfers}
          hasActiveTransfers={hasActiveTransfers}
          onCancel={onCancelTransfer}
          onDismiss={onDismissTransfer}
          onRetry={onRetryTransfer}
        />
      )}

      <ActionSheet
        visible={showMore}
        title="更多操作"
        actions={actions}
        onClose={() => setShowMore(false)}
      />

      {serverId && (
        <PathBookmarkPanel
          open={bookmarkPanelOpen}
          onClose={() => setBookmarkPanelOpen(false)}
          onNavigate={(path) => fileManagerRef.current?.navigateTo(path)}
          currentPath={(fileManagerRef.current?.currentPath ?? initialPath) || '/'}
          serverId={serverId}
        />
      )}
    </section>
  )
})

export default TerminalFileDrawer
