import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { WebRTCTransport } from '../api/transport'
import { createFileApi, type FileApi } from '../api/fileClient'
import type { FileEntry, TransferInfo } from '../types/files'
import type { PickedFile } from '../plugins/nativeFilePicker'

const PAGE_SIZE = 500

interface Clipboard {
  paths: string[]
  mode: 'copy' | 'cut'
}

/** 从 Dashboard 注入的传输回调 */
export interface TransferProps {
  transfers: TransferInfo[]
  hasActiveTransfers: boolean
  startDownload: (path: string) => Promise<void>
  startUpload: (file: File, targetDir: string) => Promise<void>
  startNativeUpload?: (pickedFile: PickedFile, targetDir: string) => Promise<void>
  cancelTransfer: (id: string) => void
  dismissTransfer: (id: string) => void
  retryTransfer: (id: string) => void
}

export interface UseFileManagerReturn {
  // 状态
  currentPath: string
  entries: FileEntry[]
  visibleEntries: FileEntry[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string
  toast: string
  hasMore: boolean

  // 隐藏文件
  showHidden: boolean
  toggleShowHidden: () => void

  // 新建目录
  showNewDir: boolean
  setShowNewDir: (show: boolean) => void
  newDirName: string
  setNewDirName: (name: string) => void
  handleMkdir: () => Promise<void>

  // 删除确认
  confirmDelete: string | null
  setConfirmDelete: (path: string | null) => void
  confirmDeleteAction: () => Promise<void>

  // 多选模式
  selectionMode: boolean
  setSelectionMode: (mode: boolean) => void
  selectedPaths: Set<string>
  handleToggleSelect: (path: string) => void
  handleSelectAll: () => void
  handleDeselectAll: () => void
  handleEnterSelectionWith: (path: string) => void

  // 剪贴板
  clipboard: Clipboard | null
  setClipboard: (cb: Clipboard | null) => void
  handleCopy: (paths: string[]) => void
  handleCut: (paths: string[]) => void
  handlePaste: () => Promise<void>

  // 批量操作
  confirmBatchDelete: boolean
  setConfirmBatchDelete: (confirm: boolean) => void
  handleBatchDelete: () => Promise<void>
  handleBatchDownload: () => void

  // 文件操作
  handleNavigate: (path: string) => void
  handleBack: () => boolean
  handleRefresh: () => void
  handleDownload: (path: string) => void
  handleUpload: (file: File | PickedFile, targetDir: string) => void
  handleDelete: (path: string) => void
  handleRename: (oldPath: string, newPath: string) => Promise<void>

  // 预览
  previewPath: string | null
  setPreviewPath: (path: string | null) => void
  handlePreview: (path: string) => void

  // 传输（从外部注入）
  transfers: TransferInfo[]
  hasActiveTransfers: boolean
  cancelTransfer: (id: string) => void
  dismissTransfer: (id: string) => void
  retryTransfer: (id: string) => void

  // API
  fileApi: FileApi

  // 加载更多
  loadMore: () => Promise<void>

  // Toast
  showToast: (msg: string) => void
}

export function useFileManager(
  transport: WebRTCTransport,
  isRelay: boolean,
  allowRelayTransfer: boolean = false,
  transferProps?: TransferProps,
  initialPath: string = '',
): UseFileManagerReturn {
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [showNewDir, setShowNewDir] = useState(false)
  const [newDirName, setNewDirName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [toast, setToast] = useState('')

  // 多选模式
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  // 剪贴板
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)

  // 预览
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  // 批量删除确认
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false)

  const fileApi = useMemo(() => createFileApi(transport), [transport])

  // 跟踪当前路径，供 transport 变更时重新加载用
  const initialPathRef = useRef(initialPath)
  const currentPathRef = useRef(initialPath)

  // 骨架屏延迟显示：API 在阈值内返回就不显示，显示后至少展示一段时间避免闪烁
  const SKELETON_DELAY = 150    // ms，超过此时间才显示骨架屏
  const SKELETON_MIN_SHOW = 200 // ms，骨架屏最少展示时间
  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skeletonShownAt = useRef<number>(0)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }, [])

  const setErrorTimed = useCallback((msg: string) => {
    setError(msg)
    setTimeout(() => setError(''), 4000)
  }, [])

  // 从外部注入的传输回调
  const {
    transfers = [],
    hasActiveTransfers = false,
    startDownload = async () => {},
    startUpload = async () => {},
    startNativeUpload,
    cancelTransfer = () => {},
    dismissTransfer = () => {},
    retryTransfer = () => {},
  } = transferProps || {}

  const loadDir = useCallback(async (path: string) => {
    // 清除上一次的延迟定时器
    if (skeletonTimer.current) {
      clearTimeout(skeletonTimer.current)
      skeletonTimer.current = null
    }

    setError('')

    // 延迟显示骨架屏：超过阈值才显示
    skeletonTimer.current = setTimeout(() => {
      skeletonShownAt.current = Date.now()
      setLoading(true)
    }, SKELETON_DELAY)

    try {
      const resp = await fileApi.listDir(path, 0, PAGE_SIZE)
      setCurrentPath(resp.path)
      currentPathRef.current = resp.path
      setEntries(resp.entries)
      setTotal(resp.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      // 如果骨架屏还没显示（API 在阈值内返回了），直接取消
      if (skeletonTimer.current) {
        clearTimeout(skeletonTimer.current)
        skeletonTimer.current = null
        setLoading(false)
      } else {
        // 骨架屏已经显示了，确保至少展示最小时间
        const elapsed = Date.now() - skeletonShownAt.current
        const remaining = SKELETON_MIN_SHOW - elapsed
        if (remaining > 0) {
          await new Promise(r => setTimeout(r, remaining))
        }
        setLoading(false)
      }
    }
  }, [fileApi])

  const loadMore = useCallback(async () => {
    if (loadingMore || entries.length >= total) return
    setLoadingMore(true)
    try {
      const resp = await fileApi.listDir(currentPath, entries.length, PAGE_SIZE)
      setEntries(prev => [...prev, ...resp.entries])
      setTotal(resp.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载更多失败')
    } finally {
      setLoadingMore(false)
    }
  }, [fileApi, currentPath, entries.length, total, loadingMore])

  // 首次加载入口目录；transport 变更（重连）时重新加载当前路径
  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (!initialLoadDone.current) {
      initialLoadDone.current = true
      loadDir(initialPathRef.current)
    } else {
      // transport 变更导致 loadDir 重建，重新加载当前路径
      loadDir(currentPathRef.current)
    }
  }, [loadDir])

  // 退出选择模式时清空选中
  useEffect(() => {
    if (!selectionMode) {
      setSelectedPaths(new Set())
    }
  }, [selectionMode])

  const handleNavigate = useCallback((path: string) => {
    setSelectionMode(false)
    loadDir(path)
  }, [loadDir])

  const handleBack = useCallback((): boolean => {
    if (confirmDelete) {
      setConfirmDelete(null)
      return true
    }
    if (confirmBatchDelete) {
      setConfirmBatchDelete(false)
      return true
    }
    if (previewPath) {
      setPreviewPath(null)
      return true
    }
    if (showNewDir) {
      setShowNewDir(false)
      setNewDirName('')
      return true
    }
    if (selectionMode) {
      setSelectionMode(false)
      return true
    }
    if (clipboard) {
      setClipboard(null)
      return true
    }
    if (currentPath === '/' || currentPath === '') return false
    const lastSlash = currentPath.lastIndexOf('/')
    const parentPath = lastSlash <= 0 ? '/' : currentPath.substring(0, lastSlash)
    handleNavigate(parentPath)
    return true
  }, [clipboard, confirmBatchDelete, confirmDelete, currentPath, handleNavigate, previewPath, selectionMode, showNewDir])

  const handleEnterSelectionWith = useCallback((path: string) => {
    setSelectionMode(true)
    setSelectedPaths(new Set([path]))
  }, [])

  const handleDownload = useCallback((path: string) => {
    if (isRelay && !allowRelayTransfer) {
      showToast('当前为 TURN 中转连接，文件传输仅在直连或 P2P 模式下可用')
      return
    }
    startDownload(path).catch(err => {
      setErrorTimed(err instanceof Error ? err.message : '下载失败')
    })
  }, [isRelay, allowRelayTransfer, startDownload, showToast, setErrorTimed])

  const handleUpload = useCallback((file: File | PickedFile, targetDir: string) => {
    if (isRelay && !allowRelayTransfer) {
      showToast('当前为 TURN 中转连接，文件传输仅在直连或 P2P 模式下可用')
      return
    }
    // PickedFile (from NativeFilePicker) has 'uri' field, File does not
    if ('uri' in file && startNativeUpload) {
      startNativeUpload(file as PickedFile, targetDir).catch(err => {
        setErrorTimed(err instanceof Error ? err.message : '上传失败')
      })
    } else {
      startUpload(file as File, targetDir).catch(err => {
        setErrorTimed(err instanceof Error ? err.message : '上传失败')
      })
    }
  }, [isRelay, allowRelayTransfer, startUpload, startNativeUpload, showToast, setErrorTimed])

  const handleDelete = useCallback((path: string) => {
    setConfirmDelete(path)
  }, [])

  const confirmDeleteAction = useCallback(async () => {
    if (!confirmDelete) return
    try {
      await fileApi.delete(confirmDelete)
      loadDir(currentPath)
    } catch (err) {
      setErrorTimed(err instanceof Error ? err.message : '删除失败')
    }
    setConfirmDelete(null)
  }, [confirmDelete, fileApi, currentPath, loadDir, setErrorTimed])

  const handleRename = useCallback(async (path: string, newPath: string) => {
    try {
      await fileApi.rename(path, newPath)
      loadDir(currentPath)
    } catch (err) {
      setErrorTimed(err instanceof Error ? err.message : '重命名失败')
    }
  }, [fileApi, currentPath, loadDir, setErrorTimed])

  const handleMkdir = useCallback(async () => {
    const name = newDirName.trim()
    if (!name) return
    const dirPath = currentPath === '/' ? '/' + name : currentPath + '/' + name
    try {
      await fileApi.mkdir(dirPath)
      setNewDirName('')
      setShowNewDir(false)
      loadDir(currentPath)
    } catch (err) {
      setErrorTimed(err instanceof Error ? err.message : '创建目录失败')
    }
  }, [newDirName, currentPath, fileApi, loadDir, setErrorTimed])

  const handleRefresh = useCallback(() => {
    loadDir(currentPath)
  }, [loadDir, currentPath])

  // 多选操作
  const handleToggleSelect = useCallback((path: string) => {
    setSelectedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const allPaths = entries
      .filter(e => showHidden || !e.name.startsWith('.'))
      .map(e => currentPath === '/' ? '/' + e.name : currentPath + '/' + e.name)
    setSelectedPaths(new Set(allPaths))
  }, [entries, currentPath, showHidden])

  const handleDeselectAll = useCallback(() => {
    setSelectedPaths(new Set())
  }, [])

  // 剪贴板操作
  const handleCopy = useCallback((paths: string[]) => {
    setClipboard({ paths, mode: 'copy' })
    showToast(`已复制 ${paths.length} 个项目`)
  }, [showToast])

  const handleCut = useCallback((paths: string[]) => {
    setClipboard({ paths, mode: 'cut' })
    showToast(`已剪切 ${paths.length} 个项目`)
  }, [showToast])

  const handlePaste = useCallback(async () => {
    if (!clipboard) return
    try {
      if (clipboard.mode === 'copy') {
        const resp = await fileApi.copy(clipboard.paths, currentPath)
        showToast(`已复制 ${resp.copied} 个项目`)
      } else {
        const resp = await fileApi.move(clipboard.paths, currentPath)
        showToast(`已移动 ${resp.moved} 个项目`)
      }
      setClipboard(null)
      loadDir(currentPath)
    } catch (err) {
      setErrorTimed(err instanceof Error ? err.message : '操作失败')
    }
  }, [clipboard, fileApi, currentPath, loadDir, showToast, setErrorTimed])

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedPaths.size === 0) return
    try {
      const resp = await fileApi.batchDelete(Array.from(selectedPaths))
      showToast(`已删除 ${resp.deleted} 个项目`)
      setSelectionMode(false)
      loadDir(currentPath)
    } catch (err) {
      setErrorTimed(err instanceof Error ? err.message : '批量删除失败')
    }
    setConfirmBatchDelete(false)
  }, [selectedPaths, fileApi, currentPath, loadDir, showToast, setErrorTimed])

  // 批量下载
  const handleBatchDownload = useCallback(() => {
    if (isRelay && !allowRelayTransfer) {
      showToast('当前为 TURN 中转连接，文件传输仅在直连或 P2P 模式下可用')
      return
    }
    const filePaths = Array.from(selectedPaths)
    for (const p of filePaths) {
      const entry = entries.find(e => {
        const fp = currentPath === '/' ? '/' + e.name : currentPath + '/' + e.name
        return fp === p
      })
      if (entry && (entry.type === 'file' || entry.type === 'symlink')) {
        startDownload(p).catch(() => {})
      }
    }
    showToast(`已开始下载 ${filePaths.length} 个文件`)
    setSelectionMode(false)
  }, [selectedPaths, entries, currentPath, isRelay, allowRelayTransfer, startDownload, showToast])

  // 预览
  const handlePreview = useCallback((path: string) => {
    setPreviewPath(path)
  }, [])

  const toggleShowHidden = useCallback(() => {
    setShowHidden(prev => !prev)
  }, [])

  // 过滤隐藏文件
  const visibleEntries = showHidden
    ? entries
    : entries.filter(e => !e.name.startsWith('.'))

  const hasMore = entries.length < total

  return {
    currentPath,
    entries,
    visibleEntries,
    total,
    loading,
    loadingMore,
    error,
    toast,
    hasMore,
    showHidden,
    toggleShowHidden,
    showNewDir,
    setShowNewDir,
    newDirName,
    setNewDirName,
    handleMkdir,
    confirmDelete,
    setConfirmDelete,
    confirmDeleteAction,
    selectionMode,
    setSelectionMode,
    selectedPaths,
    handleToggleSelect,
    handleSelectAll,
    handleDeselectAll,
    handleEnterSelectionWith,
    clipboard,
    setClipboard,
    handleCopy,
    handleCut,
    handlePaste,
    confirmBatchDelete,
    setConfirmBatchDelete,
    handleBatchDelete,
    handleBatchDownload,
    handleNavigate,
    handleBack,
    handleRefresh,
    handleDownload,
    handleUpload,
    handleDelete,
    handleRename,
    previewPath,
    setPreviewPath,
    handlePreview,
    transfers,
    hasActiveTransfers,
    cancelTransfer,
    dismissTransfer,
    retryTransfer,
    fileApi,
    loadMore,
    showToast,
  }
}
