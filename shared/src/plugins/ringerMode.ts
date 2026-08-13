import { registerPlugin } from '@capacitor/core'

interface RingerModePlugin {
  getRingerMode(): Promise<{ mode: number; silent: boolean }>
}

const RingerMode = registerPlugin<RingerModePlugin>('RingerMode')

export default RingerMode
