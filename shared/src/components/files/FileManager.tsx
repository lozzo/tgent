import { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from 'react'
import type { WebRTCTransport } from '../../api/transport'
import { useFileManager, type TransferProps } from '../../hooks/useFileManager'
import { haptic, isNativeApp } from '../../lib/platform'
import FileList from './FileList'
import FilePreview from './FilePreview'
import FileBreadcrumb from './FileBreadcrumb'
import ActionSheet from '../common/ActionSheet'

interface Props {
  transport: WebRTCTransport
  isRelay: boolean
  allowRelayTransfer?: boolean
  initialPath?: string
  onSelectionModeChange?: (mode: boolean) => void
  transferProps?: TransferProps
  onCreateSessionInDir?: (dirPath: string) => void
}

export interface FileManagerHandle {
  /** 返回上一级目录，返回 true 表示已处理，false 表示已在根目录 */
  handleBack: () => boolean
  /** 进入多选模式 */
  enterSelectionMode: () => void
  /** 切换隐藏文件显示 */
  toggleShowHidden: () => void
  /** 刷新目录 */
  refresh: () => void
  /** 当前是否显示隐藏文件 */
  showHidden: boolean
  /** 当前是否多选模式 */
  selectionMode: boolean
  /** 当前目录名 */
  currentDirName: string
  /** 触发文件上传 */
  triggerUpload: () => void
  /** 触发新建目录 */
  triggerNewDir: () => void
  /** 是否中转模式（传输不可用） */
  isRelayNoTransfer: boolean
  /** 跳转到指定路径 */
  navigateTo: (path: string) => void
  /** 当前路径 */
  currentPath: string
}

const FileManager = forwardRef<FileManagerHandle, Props>(function FileManager({ transport, isRelay, allowRelayTransfer, initialPath, onSelectionModeChange, transferProps, onCreateSessionInDir }, ref) {
  const fm = useFileManager(transport, isRelay, allowRelayTransfer, transferProps, initialPath)

  // 通知父组件多选模式变化
  useEffect(() => {
    onSelectionModeChange?.(fm.selectionMode)
  }, [fm.selectionMode, onSelectionModeChange])

  // 目录切换动画方向
  const [dirAnim, setDirAnim] = useState<'forward' | 'backward' | null>(null)
  const prevPath = useRef(fm.currentPath)
  const animKey = useRef(0)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      fm.handleUpload(files[i], fm.currentPath)
    }
    e.target.value = ''
  }

  const triggerUpload = useCallback(() => {
    if (isNativeApp()) {
      // Native 模式：使用 NativeFilePicker
      import('../../plugins/nativeFilePicker').then(m => {
        m.default.pickFiles({ multiple: true }).then(result => {
          for (const file of result.files) {
            fm.handleUpload(file, fm.currentPath)
          }
        }).catch(err => {
          console.warn('NativeFilePicker error:', err)
        })
      })
    } else {
      fileInputRef.current?.click()
    }
  }, [fm])

  useEffect(() => {
    const prev = prevPath.current
    const curr = fm.currentPath
    if (prev !== curr && prev !== undefined) {
      if (curr.startsWith(prev) && curr !== prev) {
        setDirAnim('forward')
      } else {
        setDirAnim('backward')
      }
      animKey.current++
      const timer = setTimeout(() => setDirAnim(null), 300)
      prevPath.current = curr
      return () => clearTimeout(timer)
    }
    prevPath.current = curr
  }, [fm.currentPath])

  const currentDirName = fm.currentPath === '/' ? '文件' : fm.currentPath.split('/').pop() || '文件'

  useImperativeHandle(ref, () => ({
    handleBack: fm.handleBack,
    enterSelectionMode: () => fm.setSelectionMode(true),
    toggleShowHidden: fm.toggleShowHidden,
    refresh: fm.handleRefresh,
    get showHidden() { return fm.showHidden },
    get selectionMode() { return fm.selectionMode },
    get currentDirName() { return currentDirName },
    triggerUpload,
    triggerNewDir: () => fm.setShowNewDir(true),
    get isRelayNoTransfer() { return isRelay && !allowRelayTransfer },
    navigateTo: (path: string) => fm.handleNavigate(path),
    get currentPath() { return fm.currentPath },
  }), [fm.handleBack, fm.toggleShowHidden, fm.handleRefresh, fm.showHidden, fm.selectionMode, currentDirName, isRelay, allowRelayTransfer, fm.handleNavigate, fm.currentPath, triggerUpload])

  const dirAnimClass = dirAnim === 'forward'
    ? 'animate-dir-forward'
    : dirAnim === 'backward'
      ? 'animate-dir-backward'
      : ''

  return (
    <div className="space-y-0 pb-[80px]">
      {/* 工具栏（仅多选模式） */}
      {fm.selectionMode && (
        <SelectionToolbar fm={fm} />
      )}

      {/* 面包屑路径导航 */}
      {!fm.selectionMode && (
        <div className="px-3 border-b border-[var(--color-border-subtle)]">
          <FileBreadcrumb path={fm.currentPath} onNavigate={fm.handleNavigate} />
        </div>
      )}

      <div className="p-2 space-y-2">
        {/* 新建目录输入框 */}
        {fm.showNewDir && (
          <div className="flex items-center gap-2 px-3 py-2 mx-2 bg-[var(--color-border-subtle)] rounded-xl">
            <svg className="w-4 h-4 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
            </svg>
            <input
              autoFocus
              className="flex-1 bg-transparent text-[15px] text-t-primary outline-none"
              placeholder="输入目录名"
              value={fm.newDirName}
              onChange={e => fm.setNewDirName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') fm.handleMkdir()
                if (e.key === 'Escape') { fm.setShowNewDir(false); fm.setNewDirName('') }
              }}
            />
            <button onClick={() => { haptic(); fm.handleMkdir() }} className="text-sm text-blue-500 font-medium px-2 py-1">
              创建
            </button>
          </div>
        )}

        {/* 错误提示 */}
        {fm.error && (
          <div className="px-3 py-2 mx-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[13px]">
            {fm.error}
          </div>
        )}

        {/* Toast */}
        {fm.toast && <SnackbarToast message={fm.toast} />}

        {/* 文件数量统计 */}
        {!fm.loading && fm.total > 0 && (
          <div className="text-[12px] text-t-muted px-3 pb-1">
            {fm.entries.length < fm.total
              ? `已加载 ${fm.entries.length} / ${fm.total} 项`
              : `共 ${fm.total} 项`
            }
          </div>
        )}

        {/* 文件列表（带目录切换动画） */}
        {fm.loading ? (
          <LoadingSkeleton />
        ) : (
          <div key={animKey.current} className={dirAnimClass}>
            <FileList
              entries={fm.visibleEntries}
              currentPath={fm.currentPath}
              isRelay={isRelay && !allowRelayTransfer}
              selectionMode={fm.selectionMode}
              selectedPaths={fm.selectedPaths}
              onNavigate={fm.handleNavigate}
              onDownload={fm.handleDownload}
              onDelete={fm.handleDelete}
              onRename={fm.handleRename}
              onToggleSelect={fm.handleToggleSelect}
              onCopy={fm.handleCopy}
              onCut={fm.handleCut}
              onPreview={fm.handlePreview}
              onEnterSelectionWith={fm.handleEnterSelectionWith}
              onCreateSessionInDir={onCreateSessionInDir}
            />
            {fm.hasMore && (
              <button
                onClick={() => { haptic(); fm.loadMore() }}
                disabled={fm.loadingMore}
                className="w-full py-4 text-[14px] text-blue-500 hover:text-blue-400 transition-colors disabled:text-t-muted font-medium"
              >
                {fm.loadingMore ? '加载中...' : `加载更多（剩余 ${fm.total - fm.entries.length} 项）`}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 删除确认 */}
      <ActionSheet
        visible={!!fm.confirmDelete}
        title="确认删除"
        message={fm.confirmDelete ? `${fm.confirmDelete.split('/').pop()} 将被永久删除` : ''}
        actions={[
          { label: '删除', destructive: true, onPress: () => fm.confirmDeleteAction() },
        ]}
        onClose={() => fm.setConfirmDelete(null)}
      />

      {/* 批量删除确认 */}
      <ActionSheet
        visible={fm.confirmBatchDelete}
        title="确认批量删除"
        message={`选中的 ${fm.selectedPaths.size} 个项目将被永久删除`}
        actions={[
          { label: `删除 ${fm.selectedPaths.size} 个项目`, destructive: true, onPress: () => fm.handleBatchDelete() },
        ]}
        onClose={() => fm.setConfirmBatchDelete(false)}
      />

      {/* 文件预览 */}
      {fm.previewPath && (
        <FilePreview
          path={fm.previewPath}
          fileApi={fm.fileApi}
          onClose={() => fm.setPreviewPath(null)}
        />
      )}

      {/* 多选模式底部操作栏 */}
      {fm.selectionMode && fm.selectedPaths.size > 0 && (
        <SelectionActionBar fm={fm} />
      )}

      {/* 剪贴板粘贴栏（非选择模式时显示） */}
      {!fm.selectionMode && fm.clipboard && (
        <ClipboardBar fm={fm} />
      )}

      {/* 隐藏的 File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  )
})

export default FileManager

/* ── 子组件 ── */

type FM = ReturnType<typeof useFileManager>

/** 底部 Snackbar Toast */
function SnackbarToast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 80px)' }}>
      <div className="px-4 py-2.5 rounded-xl bg-[var(--color-bg-elevated,#2c2c2e)] border border-[var(--color-border-subtle)] text-sm text-t-primary shadow-lg animate-toast-in max-w-[300px] text-center">
        {message}
      </div>
    </div>
  )
}

function SelectionToolbar({ fm }: { fm: FM }) {
  return (
    <div className="flex items-center h-[52px] px-3 shrink-0 bg-[var(--color-bg-page)] border-b border-[var(--color-border-subtle)]">
      <button onClick={() => { haptic(); fm.setSelectionMode(false) }} className="px-2 py-1 text-[15px] font-medium text-t-secondary active:opacity-70 shrink-0">
        取消
      </button>
      <div className="flex-1 flex justify-center min-w-0">
        <span className="text-[16px] font-semibold text-t-primary truncate px-2">
          已选择 {fm.selectedPaths.size} 项
        </span>
      </div>
      <button
        onClick={() => { haptic(); (fm.selectedPaths.size === fm.visibleEntries.length ? fm.handleDeselectAll : fm.handleSelectAll)() }}
        className="px-2 py-1 text-[15px] font-medium text-blue-500 active:opacity-70 shrink-0"
      >
        {fm.selectedPaths.size === fm.visibleEntries.length ? '取消全选' : '全选'}
      </button>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-0.5 py-2">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center gap-3.5 px-4 py-3 bg-[var(--color-bg-page)] animate-pulse rounded-xl">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-border-subtle)] shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-[var(--color-border-subtle)]" />
            <div className="h-3 w-1/3 rounded bg-[var(--color-border-subtle)]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SelectionActionBar({ fm }: { fm: FM }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-bg-card,#1c1c1e)]/95 backdrop-blur-xl border-t border-[var(--color-border-subtle)] safe-bottom animate-selection-bar-in">
      <div className="flex items-stretch justify-around px-2 py-2">
        <button
          onClick={() => { haptic(); fm.handleCopy(Array.from(fm.selectedPaths)); fm.setSelectionMode(false) }}
          className="flex flex-col items-center gap-1 px-3 py-1.5 text-t-secondary hover:text-blue-400 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m0 0a2.625 2.625 0 115.25 0H8.25z" />
          </svg>
          <span className="text-xs">复制</span>
        </button>
        <button
          onClick={() => { haptic(); fm.handleCut(Array.from(fm.selectedPaths)); fm.setSelectionMode(false) }}
          className="flex flex-col items-center gap-1 px-3 py-1.5 text-t-secondary hover:text-blue-400 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm1.536.887a2.165 2.165 0 011.083 1.839c.005.351.054.695.14 1.024M9.384 9.137l2.077 1.199M7.848 15.75l1.536-.887m-1.536.887a3 3 0 11-5.196 3 3 3 0 015.196-3zm1.536-.887a2.165 2.165 0 001.083-1.838c.005-.352.054-.695.14-1.025m-1.223 2.863l2.077-1.199m0-3.328a4.323 4.323 0 012.068-1.379l5.325-1.628a4.5 4.5 0 012.48-.044l.803.215-7.794 4.5m-2.882-1.664A4.331 4.331 0 0010.607 12m3.736 0l7.794 4.5-.803.215a4.5 4.5 0 01-2.48-.043l-5.326-1.629a4.324 4.324 0 01-2.068-1.379M14.343 12l-2.882 1.664" />
          </svg>
          <span className="text-xs">剪切</span>
        </button>
        <button
          onClick={() => { haptic(); fm.handleBatchDownload() }}
          className="flex flex-col items-center gap-1 px-3 py-1.5 text-t-secondary hover:text-blue-400 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          <span className="text-xs">下载</span>
        </button>
        <button
          onClick={() => { haptic(); fm.setConfirmBatchDelete(true) }}
          className="flex flex-col items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          <span className="text-xs">删除</span>
        </button>
      </div>
    </div>
  )
}

/** 剪贴板粘贴栏 */
function ClipboardBar({ fm }: { fm: FM }) {
  const label = fm.clipboard!.mode === 'copy' ? '复制' : '剪切'
  const count = fm.clipboard!.paths.length
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-bg-card,#1c1c1e)]/95 backdrop-blur-xl border-t border-[var(--color-border-subtle)] safe-bottom animate-selection-bar-in">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm text-t-secondary">
          已{label} {count} 个项目
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { haptic(); fm.handlePaste() }}
            className="px-4 py-1.5 text-sm font-medium text-white bg-blue-500 rounded-lg active:opacity-80"
          >
            粘贴到此处
          </button>
          <button
            onClick={() => { haptic(); fm.setClipboard(null) }}
            className="px-3 py-1.5 text-sm text-t-muted active:opacity-70"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
