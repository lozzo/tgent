import { useState, useEffect } from 'react'
import type { DownloadProgressEvent } from '../plugins/appUpdater'
import {
  downloadAndInstallApk,
  skipVersion,
} from '../services/updateService'
import { eventBus } from '../state/EventBus'

interface UpdateInfo {
  version: string
  versionCode: number
  changelog: string
  forceUpdate: boolean
  downloadUrl: string
  fileName: string
  fileSize: number
  fileHash: string
}

interface UpdateDialogProps {
  info: UpdateInfo
  onClose: () => void
}

export default function UpdateDialog({ info, onClose }: UpdateDialogProps) {
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)

  // 拦截返回手势/back button，防止穿透到后面页面
  useEffect(() => {
    // 推入一个 history 条目，popstate 时吞掉并重新推入
    history.pushState(null, '', location.href)
    const onPopState = () => {
      history.pushState(null, '', location.href)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const handleUpdate = async () => {
    setDownloading(true)
    setProgress(0)

    const onProgress = (event: DownloadProgressEvent) => {
      setProgress(event.progress)
    }

    try {
      await downloadAndInstallApk(info as any, onProgress)
    } catch (err: any) {
      eventBus.emit('toast:show', { message: `更新失败: ${err?.message || '未知错误'}`, type: 'error' })
      setDownloading(false)
    }
  }

  const handleSkip = async () => {
    await skipVersion(info.version)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
      <div className="w-[85%] max-w-sm rounded-2xl bg-elevated border border-t-border p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-t-primary mb-2">
          发现新版本 v{info.version}
        </h2>

        {info.changelog && (
          <div className="mb-4 max-h-32 overflow-y-auto text-sm text-t-secondary whitespace-pre-wrap">
            {info.changelog}
          </div>
        )}

        {downloading ? (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-t-muted mb-1">
              <span>下载中...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--color-background)]">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex gap-3">
          {!info.forceUpdate && !downloading && (
            <button
              onClick={handleSkip}
              className="flex-1 py-2.5 rounded-lg bg-[var(--color-background)] text-t-secondary text-sm font-medium active:opacity-70 transition-opacity"
            >
              稍后提醒
            </button>
          )}
          <button
            onClick={handleUpdate}
            disabled={downloading}
            className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium active:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {downloading ? '更新中...' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  )
}
