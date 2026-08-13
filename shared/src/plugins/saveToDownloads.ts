import { registerPlugin } from '@capacitor/core'

interface SaveToDownloadsPlugin {
  save(options: {
    data: string
    fileName: string
    subDir?: string
  }): Promise<{ path: string }>

  openFile(options: {
    fileName: string
    subDir?: string
  }): Promise<{ sessionId: string }>

  writeChunk(options: {
    sessionId: string
    data: string
  }): Promise<void>

  closeFile(options: {
    sessionId: string
    success: boolean
  }): Promise<{ path?: string }>
}

const SaveToDownloads = registerPlugin<SaveToDownloadsPlugin>('SaveToDownloads')

export default SaveToDownloads
