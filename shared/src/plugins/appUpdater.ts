import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

export interface AppVersionInfo {
  versionName: string
  versionCode: number
}

export interface CheckFileResult {
  exists: boolean
  size: number
  path: string
}

export interface DownloadResult {
  path: string
  size: number
}

export interface DownloadProgressEvent {
  progress: number
  loaded: number
  total: number
}

interface AppUpdaterPlugin {
  getAppVersion(): Promise<AppVersionInfo>
  checkFile(options: { fileName: string }): Promise<CheckFileResult>
  downloadFile(options: { url: string; fileName: string }): Promise<DownloadResult>
  installApk(options: { path: string }): Promise<void>
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: DownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')

export default AppUpdater
