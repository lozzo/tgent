import { registerPlugin } from '@capacitor/core'

interface NativeHapticPlugin {
  impact(): Promise<void>
}

const NativeHaptic = registerPlugin<NativeHapticPlugin>('NativeHaptic')

export default NativeHaptic
