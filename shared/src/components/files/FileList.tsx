import type { FileEntry } from '../../types/files'
import FileListItem from './FileListItem'

interface Props {
  entries: FileEntry[]
  currentPath: string
  isRelay: boolean
  selectionMode: boolean
  selectedPaths: Set<string>
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

export default function FileList({
  entries, currentPath, isRelay, selectionMode, selectedPaths,
  onNavigate, onDownload, onDelete, onRename, onToggleSelect, onCopy, onCut, onPreview,
  onEnterSelectionWith, onCreateSessionInDir,
}: Props) {
  // 排序：目录在前（包括 symlink-dir），文件在后；同类型按名称排序
  const sorted = [...entries].sort((a, b) => {
    const aIsDir = a.type === 'dir' || a.type === 'symlink-dir'
    const bIsDir = b.type === 'dir' || b.type === 'symlink-dir'
    if (aIsDir && !bIsDir) return -1
    if (!aIsDir && bIsDir) return 1
    return a.name.localeCompare(b.name)
  })

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
        <div className="w-20 h-20 mb-4 rounded-full bg-[var(--color-border-subtle)] flex items-center justify-center opacity-80">
          <svg className="w-10 h-10 text-t-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
        </div>
        <p className="text-[15px] font-medium text-t-primary mb-1">这里空空如也</p>
        <p className="text-xs text-t-muted">暂无文件或目录</p>
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {sorted.map(entry => {
        const fullPath = currentPath === '/'
          ? '/' + entry.name
          : currentPath + '/' + entry.name
        return (
          <FileListItem
            key={entry.name}
            entry={entry}
            currentPath={currentPath}
            isRelay={isRelay}
            selectionMode={selectionMode}
            selected={selectedPaths.has(fullPath)}
            onNavigate={onNavigate}
            onDownload={onDownload}
            onDelete={onDelete}
            onRename={onRename}
            onToggleSelect={onToggleSelect}
            onCopy={onCopy}
            onCut={onCut}
            onPreview={onPreview}
            onEnterSelectionWith={onEnterSelectionWith}
            onCreateSessionInDir={onCreateSessionInDir}
          />
        )
      })}
    </div>
  )
}
