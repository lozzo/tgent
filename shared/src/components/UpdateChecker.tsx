import { useEffect, useState, useCallback } from 'react'
import { isNativeApp } from '../lib/platform'
import {
  checkForApkUpdate,
  isVersionSkipped,
} from '../services/updateService'
import UpdateDialog from './UpdateDialog'
import { eventBus } from '../state/EventBus'

/**
 * Auto update checker — renders invisibly, triggers update dialogs.
 * Mount inside AppProvider.
 */
export default function UpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<any>(null)

  const runCheck = useCallback(async (): Promise<boolean> => {
    if (!isNativeApp()) return false

    try {
      const apkUpdate = await checkForApkUpdate()
      if (apkUpdate) {
        const skipped = await isVersionSkipped(apkUpdate.version)
        if (skipped && !apkUpdate.forceUpdate) return false
        setUpdateInfo(apkUpdate)
        return true
      }
      return false
    } catch (err) {
      console.warn('[UpdateChecker] error:', err)
      return false
    }
  }, [])

  useEffect(() => {
    // Delay 3s after app start
    const timer = setTimeout(runCheck, 3000)
    return () => clearTimeout(timer)
  }, [runCheck])

  // Listen for manual check requests
  useEffect(() => {
    const handler = () => {
      runCheck().then((found) => {
        if (found) {
          eventBus.emit('update:result', { status: 'available' })
        } else {
          eventBus.emit('update:result', { status: 'latest' })
          eventBus.emit('toast:show', { message: '已是最新版本', type: 'success', duration: 2000 })
        }
      }).catch((err) => {
        const message = err instanceof Error ? err.message : '检查更新失败'
        eventBus.emit('update:result', { status: 'error', message })
        eventBus.emit('toast:show', { message, type: 'error', duration: 2000 })
      })
    }
    const off = eventBus.on('update:check', handler)
    return off
  }, [runCheck])

  if (!updateInfo) return null

  return (
    <UpdateDialog
      info={updateInfo}
      onClose={() => setUpdateInfo(null)}
    />
  )
}
