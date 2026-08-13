import { registerPlugin } from '@capacitor/core'

interface ForegroundServicePlugin {
  start(options?: { content?: string; deep?: boolean }): Promise<void>
  stop(): Promise<void>
  requestPermission(): Promise<{ granted: boolean }>
}

const ForegroundService = registerPlugin<ForegroundServicePlugin>('ForegroundService')

export default ForegroundService
