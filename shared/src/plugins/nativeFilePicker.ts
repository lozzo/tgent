import { registerPlugin } from '@capacitor/core'

export interface PickedFile {
  uri: string
  name: string
  size: number
  mimeType: string
}

interface NativeFilePickerPlugin {
  pickFiles(options?: { multiple?: boolean }): Promise<{ files: PickedFile[] }>
}

const NativeFilePicker = registerPlugin<NativeFilePickerPlugin>('NativeFilePicker')

export default NativeFilePicker
