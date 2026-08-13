import AppUpdater from '../plugins/appUpdater'
import type { DownloadProgressEvent } from '../plugins/appUpdater'
import { isNativeApp, getWebUrl } from '../lib/platform'
import { storage } from '../lib/storage'

interface AppReleaseInfo {
  update: boolean
  version: string
  versionCode: number
  fileName: string
  fileSize: number
  fileHash: string
  changelog: string
  forceUpdate: boolean
  downloadUrl: string
  mirrors: string[]
}

const SKIP_KEY_PREFIX = 'update_skip_'
const SKIP_DURATION = 24 * 60 * 60 * 1000 // 24h

/**
 * Check for APK update
 */
export async function checkForApkUpdate(): Promise<AppReleaseInfo | null> {
  if (!isNativeApp()) return null

  try {
    const { versionCode: currentCode } = await AppUpdater.getAppVersion()
    const info = await fetchAppRelease()
    if (!info || !info.update) return null

    if (info.versionCode <= currentCode) return null
    return info
  } catch (err) {
    console.warn('[updateService] checkForApkUpdate error:', err)
    return null
  }
}

/**
 * Download APK and trigger system installer
 */
export async function downloadAndInstallApk(
  info: AppReleaseInfo,
  onProgress?: (event: DownloadProgressEvent) => void
): Promise<void> {
  let listenerHandle: { remove: () => Promise<void> } | null = null
  let downloadPath: string | null = null

  try {
    // 检查本地是否已有匹配的文件（文件名 + 大小一致则复用）
    if (info.fileName && info.fileSize > 0) {
      try {
        const cached = await AppUpdater.checkFile({ fileName: info.fileName })
        if (cached.exists && cached.size === info.fileSize) {
          console.log(`[updateService] reusing cached file: ${cached.path} (${cached.size} bytes)`)
          downloadPath = cached.path
        }
      } catch (err) {
        console.warn('[updateService] checkFile failed, will re-download:', err)
      }
    }

    if (!downloadPath) {
      if (onProgress) {
        listenerHandle = await AppUpdater.addListener('downloadProgress', onProgress)
      }

      // 构建下载 URL 列表：主 URL + 镜像，去重
      const urls = [info.downloadUrl, ...(info.mirrors || [])].filter(
        (url, i, arr) => url && arr.indexOf(url) === i
      )

      let lastErr: unknown

      for (const url of urls) {
        try {
          console.log(`[updateService] trying download from: ${url}`)
          const { path } = await AppUpdater.downloadFile({
            url,
            fileName: info.fileName,
          })
          downloadPath = path
          break
        } catch (err) {
          console.warn(`[updateService] download from ${url} failed:`, err)
          lastErr = err
        }
      }

      if (!downloadPath) {
        throw lastErr || new Error('All mirror downloads failed')
      }
    }

    await AppUpdater.installApk({ path: downloadPath })
  } finally {
    if (listenerHandle) {
      await listenerHandle.remove()
    }
  }
}

/**
 * Check if a version has been skipped (within 24h)
 */
export async function isVersionSkipped(version: string): Promise<boolean> {
  const key = SKIP_KEY_PREFIX + version
  const skippedAt = await storage.get(key)
  if (!skippedAt) return false
  return Date.now() - Number(skippedAt) < SKIP_DURATION
}

/**
 * Skip a version for 24h
 */
export async function skipVersion(version: string): Promise<void> {
  const key = SKIP_KEY_PREFIX + version
  await storage.set(key, String(Date.now()))
}

/**
 * Fetch app release info from server
 */
async function fetchAppRelease(): Promise<AppReleaseInfo | null> {
  try {
    const webUrl = await getWebUrl()
    const resp = await fetch(
      `${webUrl}/api/v1/app/releases/latest?platform=android`,
      { signal: AbortSignal.timeout(10000) }
    )
    if (!resp.ok) return null
    return resp.json()
  } catch {
    return null
  }
}
