import { useState, useRef, useCallback } from 'react'
import type { FileEntry } from '../../types/files'
import { haptic } from '../../lib/platform'
import ActionSheet, { type ActionSheetAction } from '../common/ActionSheet'

// 可预览的文本扩展名
const previewableTextExts = new Set([
  'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'py',
  'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'yaml', 'yml', 'toml',
  'xml', 'sh', 'bash', 'conf', 'cfg', 'ini', 'log', 'sql', 'env',
  'vue', 'svelte', 'scss', 'less', 'mod', 'sum', 'lock',
])
const previewableImageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
const previewableNoExtNames = new Set(['dockerfile', 'makefile', '.gitignore', '.env', '.editorconfig'])

function isPreviewable(entry: FileEntry): boolean {
  if (entry.type !== 'file' && entry.type !== 'symlink') return false
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  const baseName = entry.name.toLowerCase()
  if (previewableNoExtNames.has(baseName)) return true
  if (previewableTextExts.has(ext)) return entry.size <= 5 * 1024 * 1024
  if (previewableImageExts.has(ext)) return entry.size <= 10 * 1024 * 1024
  return false
}
interface Props {
  entry: FileEntry
  currentPath: string
  isRelay: boolean
  selectionMode: boolean
  selected: boolean
  onNavigate: (path: string) => void
  onDownload: (path: string) => void
  onDelete: (path: string) => void
  onRename: (path: string, newName: string) => void
  onToggleSelect: (path: string) => void
  onCopy: (paths: string[]) => void
  onCut: (paths: string[]) => void
  onPreview: (path: string) => void
  onEnterSelectionWith: (path: string) => void
  onCreateSessionInDir?: (dirPath: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(isoTime: string): string {
  try {
    const d = new Date(isoTime)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    if (diff < 86400000 * 30) return `${Math.floor(diff / 86400000)} 天前`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

function FileIcon({ type, name }: { type: string, name: string }) {
  if (type === 'dir' || type === 'symlink-dir') {
    return (
      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 relative">
        <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
        {type === 'symlink-dir' && (
          <svg className="w-3 h-3 text-purple-500 absolute -bottom-0.5 -right-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    )
  }

  const ext = name.split('.').pop()?.toLowerCase() || ''

  if (previewableImageExts.has(ext)) {
    return (
      <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0 relative">
        <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
        </svg>
        {type === 'symlink' && (
          <svg className="w-3 h-3 text-purple-500 absolute -bottom-0.5 -right-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    )
  }

  if (previewableTextExts.has(ext) || previewableNoExtNames.has(name.toLowerCase())) {
    return (
      <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0 relative">
        <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
        </svg>
        {type === 'symlink' && (
          <svg className="w-3 h-3 text-purple-500 absolute -bottom-0.5 -right-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    )
  }

  return (
    <div className="w-10 h-10 rounded-xl bg-[var(--color-border-subtle)] flex items-center justify-center shrink-0 relative">
      <svg className="w-5 h-5 text-t-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      {type === 'symlink' && (
        <svg className="w-3 h-3 text-purple-500 absolute -bottom-0.5 -right-0.5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" clipRule="evenodd" />
          </svg>
      )}
    </div>
  )
}

/** 写入系统剪贴板（静默失败） */
function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {})
}

export default function FileListItem({
  entry, currentPath, isRelay, selectionMode, selected,
  onNavigate, onDownload, onDelete, onRename, onToggleSelect, onCopy, onCut, onPreview,
  onEnterSelectionWith, onCreateSessionInDir,
}: Props) {
  const [showActionSheet, setShowActionSheet] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState(entry.name)

  // 长按检测
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggered = useRef(false)
  const touchMoved = useRef(false)

  const handleTouchStart = useCallback(() => {
    if (selectionMode || isRenaming) return
    longPressTriggered.current = false
    touchMoved.current = false
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true
      haptic()
      setShowActionSheet(true)
    }, 500)
  }, [selectionMode, isRenaming])

  const handleTouchMove = useCallback(() => {
    if (!touchMoved.current) {
      touchMoved.current = true
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const fullPath = currentPath === '/'
    ? '/' + entry.name
    : currentPath + '/' + entry.name

  const isClickable = entry.type === 'dir' || entry.type === 'symlink-dir'
  const canPreview = isPreviewable(entry)
  const canDownload = entry.type === 'file' || entry.type === 'symlink'

  const handleClick = () => {
    if (isRenaming) return
    if (longPressTriggered.current) { longPressTriggered.current = false; return }
    haptic()
    if (selectionMode) {
      onToggleSelect(fullPath)
      return
    }
    if (entry.type === 'dir') {
      onNavigate(fullPath)
    } else if (entry.type === 'symlink-dir' && entry.link_target) {
      onNavigate(entry.link_target)
    } else if (canPreview) {
      onPreview(fullPath)
    }
  }

  const handleRenameSubmit = () => {
    const trimmed = newName.trim()
    if (trimmed && trimmed !== entry.name) {
      const newFullPath = currentPath === '/'
        ? '/' + trimmed
        : currentPath + '/' + trimmed
      onRename(fullPath, newFullPath)
    }
    setIsRenaming(false)
  }

  // ── Action Sheet 操作列表 ──
  const actions: ActionSheetAction[] = []
  if (canPreview) {
    actions.push({ label: '预览', onPress: () => onPreview(fullPath) })
  }
  if (canDownload) {
    actions.push({
      label: '下载',
      disabled: isRelay,
      disabledLabel: '下载（中转不可用）',
      onPress: () => onDownload(fullPath),
    })
  }
  actions.push(
    { label: '复制路径', onPress: () => copyToClipboard(fullPath) },
    { label: '复制', onPress: () => onCopy([fullPath]) },
    { label: '剪切', onPress: () => onCut([fullPath]) },
    { label: '重命名', onPress: () => { setIsRenaming(true); setNewName(entry.name) } },
    { label: '选择', onPress: () => onEnterSelectionWith(fullPath) },
  )
  if ((entry.type === 'dir' || entry.type === 'symlink-dir') && onCreateSessionInDir) {
    actions.push({ label: '在此目录新建 Session', onPress: () => onCreateSessionInDir(fullPath) })
  }
  actions.push(
    { label: '删除', destructive: true, onPress: () => onDelete(fullPath) },
  )

  return (
    <>
      <div className="rounded-xl">
        <div
          className={`flex items-center gap-3.5 px-4 py-3 transition-colors bg-[var(--color-bg-page)] ${
            isClickable || canPreview || selectionMode ? 'cursor-pointer' : ''
          } ${selected ? 'bg-blue-500/10' : ''} active:bg-[var(--color-border-subtle)]`}
          onClick={handleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onContextMenu={e => e.preventDefault()}
        >
          {/* 选择模式圆形标记 */}
          {selectionMode && (
            <div className="shrink-0" onClick={e => e.stopPropagation()}>
              <div
                className={`w-[22px] h-[22px] rounded-full border-2 flex items-center justify-center transition-colors ${
                  selected
                    ? 'bg-blue-500 border-blue-500'
                    : 'border-t-muted/40 bg-transparent'
                }`}
                onClick={() => onToggleSelect(fullPath)}
              >
                {selected && (
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                )}
              </div>
            </div>
          )}

          <FileIcon type={entry.type} name={entry.name} />

          <div className="flex-1 min-w-0">
            {isRenaming ? (
              <input
                autoFocus
                className="bg-transparent text-t-primary text-[15px] w-full outline-none border-b border-blue-400 py-0.5"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameSubmit()
                  if (e.key === 'Escape') { setIsRenaming(false); setNewName(entry.name) }
                }}
                onBlur={handleRenameSubmit}
                onClick={e => e.stopPropagation()}
              />
            ) : (
              <span className={`text-[15px] truncate block ${entry.name.startsWith('.') ? 'text-t-muted' : 'text-t-primary'} ${isClickable ? 'font-medium' : ''}`}>
                {entry.name}
              </span>
            )}
            <div className="flex items-center text-[12px] text-t-muted mt-0.5 whitespace-nowrap overflow-hidden">
              {(entry.type === 'file' || entry.type === 'symlink') && <span className="mr-1.5">{formatSize(entry.size)}</span>}
              {(entry.type === 'file' || entry.type === 'symlink') && entry.mod_time && !entry.link_target && <span className="mr-1.5 opacity-50">•</span>}
              {entry.mod_time && !entry.link_target && <span>{formatTime(entry.mod_time)}</span>}
              {entry.link_target && (
                <>
                  {entry.mod_time && <span className="mx-1.5 opacity-50">•</span>}
                  <span className="text-purple-400/70 truncate max-w-[150px]" title={entry.link_target}>
                    → {entry.link_target}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* 右侧三点菜单按钮（所有项目都有） */}
          {!selectionMode && !isRenaming && (
            <button
              onClick={e => { e.stopPropagation(); haptic(); setShowActionSheet(true) }}
              className="p-1.5 rounded-lg text-t-muted/50 shrink-0"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Action Sheet */}
      <ActionSheet
        visible={showActionSheet}
        title={entry.name}
        actions={actions}
        onClose={() => setShowActionSheet(false)}
      />
    </>
  )
}
