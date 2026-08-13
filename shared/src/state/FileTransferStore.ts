/**
 * FileTransferStore — 单 server 文件传输状态管理
 *
 * 从 useFileTransfer hook 提取的纯 class，生命周期不依赖 React 组件。
 * 使用 subscribe/getSnapshot 模式（与 ConnectionStore 一致）。
 */

import type { WebRTCTransport } from '../api/transport'
import { createFileApi, type FileApi } from '../api/fileClient'
import type { TransferInfo } from '../types/files'
import { isNativeApp } from '../lib/platform'
import { bytesToBase64 } from '../api/crypto'
import type { NativeBridgeClient, TransferSyncPayload } from './NativeBridgeClient'
import type { PickedFile } from '../plugins/nativeFilePicker'

const FRAME_DATA = 0x01
const FRAME_COMPLETE = 0x02
const FRAME_ERROR = 0xFF

export interface FileTransferSnapshot {
  transfers: TransferInfo[]
  hasActiveTransfers: boolean
}

export class FileTransferStore {
  private _transfers: TransferInfo[] = []
  private _listeners = new Set<() => void>()
  private _transport: WebRTCTransport | undefined
  private _fileApi: FileApi | null = null
  private _snapshotVersion = 0
  private _cachedSnapshot?: FileTransferSnapshot
  private _cachedSnapshotVersion = -1
  private _bridge: NativeBridgeClient | null = null
  private _bridgeUnsub: (() => void) | null = null
  private _storeKey: string = ''
  private _activeChannels = new Map<string, { close: () => void }>()

  /** 传输完成回调（用于刷新文件列表等） */
  onTransferComplete?: (transfer: TransferInfo) => void

  // ========== Store key 管理 ==========

  setStoreKey(key: string): void {
    this._storeKey = key
  }

  // ========== Bridge 管理 ==========

  setBridge(bridge: NativeBridgeClient | null): void {
    // 清理旧订阅
    if (this._bridgeUnsub) {
      this._bridgeUnsub()
      this._bridgeUnsub = null
    }
    this._bridge = bridge

    if (bridge) {
      this._bridgeUnsub = bridge.onTransferSync((data) => {
        this._handleTransferSync(data)
      })
    }
  }

  // ========== Transport 管理 ==========

  setTransport(transport: WebRTCTransport | undefined): void {
    const prev = this._transport
    this._transport = transport
    this._fileApi = transport ? createFileApi(transport) : null

    // Transport 消失 → 标记活跃传输为失败并关闭对应通道。
    if (prev && !transport) {
      const active = this._transfers.filter(
        t => t.status === 'pending' || t.status === 'transferring'
      )
      for (const t of active) {
        this._updateTransfer(t.id, { status: 'failed', error: '连接断开' })
        this._activeChannels.get(t.id)?.close()
      }
    }

    // 新 transport 出现 → 自动续传因断连失败的上传
    if (transport && this._fileApi && prev !== transport) {
      const resumable = this._transfers.filter(
        t => t.status === 'failed' && t.error === '连接断开'
      )
      for (const t of resumable) {
        if (t.direction === 'upload' && t.file && t.targetDir) {
          this._resumeUpload(t)
        } else if (t.direction === 'download' && t.filePath) {
          this._removeTransfer(t.id)
          this.startDownload(t.filePath).catch(() => {})
        }
      }
    }
  }

  getTransport(): WebRTCTransport | undefined {
    return this._transport
  }

  // ========== 传输操作 ==========

  async startDownload(path: string): Promise<void> {
    if (!this._transport || !this._fileApi) return

    const transport = this._transport
    const fileApi = this._fileApi
    const init = await fileApi.downloadInit(path)
    const { transfer_id, name, size } = init

    const fileName = name || path.split('/').pop() || 'file'

    const info: TransferInfo = {
      id: transfer_id,
      name: fileName,
      direction: 'download',
      totalSize: size,
      transferredSize: 0,
      status: 'pending',
      startedAt: Date.now(),
      filePath: path,
    }
    this._addTransfer(info)

    const native = isNativeApp()
    let sessionId: string | null = null
    let saveToDownloads: (typeof import('../plugins/saveToDownloads'))['default'] | null = null

    // The remote starts sending as soon as its DataChannel opens. Prepare the
    // Android destination first so a fast local connection cannot outrun it.
    if (native) {
      try {
        saveToDownloads = (await import('../plugins/saveToDownloads')).default
        const result = await saveToDownloads.openFile({ fileName: info.name })
        sessionId = result.sessionId
      } catch (e) {
        this._updateTransfer(transfer_id, {
          status: 'failed',
          error: `打开文件失败: ${e instanceof Error ? e.message : String(e)}`,
        })
        return
      }

      const current = this._transfers.find(t => t.id === transfer_id)
      if (!current || current.status === 'cancelled') {
        void saveToDownloads.closeFile({ sessionId, success: false }).catch(() => {})
        return
      }
    }

    const dc = transport.createFileChannel(transfer_id)
    if (!dc) {
      if (native && sessionId && saveToDownloads) {
        void saveToDownloads.closeFile({ sessionId, success: false }).catch(() => {})
      }
      this._updateTransfer(transfer_id, { status: 'failed', error: '无法创建传输通道' })
      return
    }
    this._activeChannels.set(transfer_id, dc)

    const chunks: ArrayBuffer[] = []
    let received = 0
    let finished = false
    let completionReceived = false
    let nativeFlushTimer: ReturnType<typeof setTimeout> | null = null

    let progressTimer: ReturnType<typeof setTimeout> | null = null
    const flushProgress = () => {
      if (progressTimer) return
      progressTimer = setTimeout(() => {
        progressTimer = null
        if (!finished) this._updateTransfer(transfer_id, { transferredSize: received })
      }, 200)
    }

    const STALL_TIMEOUT = 60_000
    let stallTimer: ReturnType<typeof setTimeout> | null = null

    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer)
      if (finished) return
      stallTimer = setTimeout(() => {
        if (!finished) {
          finished = true
          cleanup()
          cleanupNativeSession()
          this._updateTransfer(transfer_id, { status: 'failed', error: '下载超时：长时间未收到数据' })
          dc.close()
        }
      }, STALL_TIMEOUT)
    }

    const cleanup = () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
      if (progressTimer) { clearTimeout(progressTimer); progressTimer = null }
      if (nativeFlushTimer) { clearTimeout(nativeFlushTimer); nativeFlushTimer = null }
      this._activeChannels.delete(transfer_id)
    }

    const cleanupNativeSession = () => {
      const id = sessionId
      sessionId = null
      if (native && id && saveToDownloads) {
        void saveToDownloads.closeFile({ sessionId: id, success: false }).catch(() => {})
      }
    }

    dc.binaryType = 'arraybuffer'
    let writeChain = Promise.resolve()
    const NATIVE_WRITE_BATCH_SIZE = 512 * 1024
    const NATIVE_WRITE_FLUSH_MS = 40
    let nativeChunks: Uint8Array[] = []
    let nativeChunkBytes = 0

    const flushNativeChunks = () => {
      if (!native || nativeChunkBytes === 0) return
      if (nativeFlushTimer) {
        clearTimeout(nativeFlushTimer)
        nativeFlushTimer = null
      }
      const pendingChunks = nativeChunks
      const pendingBytes = nativeChunkBytes
      nativeChunks = []
      nativeChunkBytes = 0
      writeChain = writeChain.then(async () => {
        if (finished || !sessionId || !saveToDownloads) return
        const batch = new Uint8Array(pendingBytes)
        let offset = 0
        for (const chunk of pendingChunks) {
          batch.set(chunk, offset)
          offset += chunk.length
        }
        await saveToDownloads.writeChunk({ sessionId, data: bytesToBase64(batch) })
      }).catch((e) => {
        if (finished) return
        finished = true
        cleanup()
        cleanupNativeSession()
        this._updateTransfer(transfer_id, {
          status: 'failed',
          error: `写入失败: ${e instanceof Error ? e.message : String(e)}`,
        })
        dc.close()
      })
    }

    const enqueueNativeChunk = (chunk: Uint8Array) => {
      nativeChunks.push(chunk)
      nativeChunkBytes += chunk.length
      if (nativeChunkBytes >= NATIVE_WRITE_BATCH_SIZE) {
        flushNativeChunks()
      } else if (!nativeFlushTimer) {
        nativeFlushTimer = setTimeout(flushNativeChunks, NATIVE_WRITE_FLUSH_MS)
      }
    }

    dc.onopen = () => {
      this._updateTransfer(transfer_id, { status: 'transferring' })
      resetStallTimer()
    }

    dc.onmessage = (ev) => {
      const data = new Uint8Array(ev.data)
      if (data.length === 0) return

      const frameType = data[0]

      if (frameType === FRAME_DATA) {
        if (data.length < 5) return
        const chunkData = data.slice(5)
        received += chunkData.length
        flushProgress()
        resetStallTimer()

        if (native && sessionId) {
          enqueueNativeChunk(chunkData)
        } else {
          chunks.push(chunkData.buffer.slice(chunkData.byteOffset, chunkData.byteOffset + chunkData.byteLength))
        }
      } else if (frameType === FRAME_COMPLETE) {
        completionReceived = true
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
        flushNativeChunks()
        writeChain.then(() => {
          if (finished) return
          finished = true
          cleanup()

          if (native && sessionId && saveToDownloads) {
            const completedSessionId = sessionId
            sessionId = null
            saveToDownloads.closeFile({ sessionId: completedSessionId, success: true }).then(() => {
              this._updateTransfer(transfer_id, { status: 'completed', transferredSize: received })
              this._notifyComplete(transfer_id)
              setTimeout(() => this._removeTransfer(transfer_id), 3000)
            }).catch((e) => {
              this._updateTransfer(transfer_id, {
                status: 'failed',
                error: `保存文件失败: ${e instanceof Error ? e.message : String(e)}`,
              })
            })
          } else {
            const blob = new Blob(chunks)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = info.name
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)

            this._updateTransfer(transfer_id, { status: 'completed', transferredSize: received })
            this._notifyComplete(transfer_id)
            setTimeout(() => this._removeTransfer(transfer_id), 3000)
          }
        })
      } else if (frameType === FRAME_ERROR) {
        if (finished) return
        finished = true
        cleanup()
        cleanupNativeSession()
        const errMsg = new TextDecoder().decode(data.slice(1))
        this._updateTransfer(transfer_id, { status: 'failed', error: errMsg })
      }
    }

    dc.onerror = () => {
      if (finished) return
      finished = true
      cleanup()
      cleanupNativeSession()
      this._updateTransfer(transfer_id, { status: 'failed', error: '传输通道错误' })
    }

    dc.onclose = () => {
      if (completionReceived) return
      cleanup()
      if (!finished) {
        finished = true
        cleanupNativeSession()
        const current = this._transfers.find(t => t.id === transfer_id)
        if (current && (current.status === 'transferring' || current.status === 'pending')) {
          this._updateTransfer(transfer_id, { status: 'failed', error: '传输通道意外关闭' })
        }
      }
    }
  }

  async startUpload(file: File, targetDir: string): Promise<void> {
    if (!this._transport || !this._fileApi) return

    const transport = this._transport
    const fileApi = this._fileApi
    const targetPath = targetDir.endsWith('/')
      ? targetDir + file.name
      : targetDir + '/' + file.name

    const init = await fileApi.uploadInit(targetPath, file.size)
    const { transfer_id, chunk_size } = init

    const info: TransferInfo = {
      id: transfer_id,
      name: file.name,
      direction: 'upload',
      totalSize: file.size,
      transferredSize: 0,
      status: 'pending',
      startedAt: Date.now(),
      file,
      targetDir,
    }
    this._addTransfer(info)

    void this._doUpload(transport, fileApi, transfer_id, file, 0, chunk_size || 64 * 1024).catch(() => {})
  }

  /** Upload a generated temporary file and resolve only after it exists remotely. */
  async uploadTemporaryFile(file: File, targetDir: string): Promise<string> {
    if (!this._transport || !this._fileApi) {
      throw new Error('文件传输连接尚未就绪')
    }

    const transport = this._transport
    const fileApi = this._fileApi
    const targetPath = targetDir.endsWith('/')
      ? targetDir + file.name
      : targetDir + '/' + file.name
    const init = await fileApi.uploadInit(targetPath, file.size)
    const { transfer_id, chunk_size } = init

    this._addTransfer({
      id: transfer_id,
      name: file.name,
      direction: 'upload',
      totalSize: file.size,
      transferredSize: 0,
      status: 'pending',
      startedAt: Date.now(),
      file,
      targetDir,
    })

    return this._doUpload(transport, fileApi, transfer_id, file, 0, chunk_size || 64 * 1024)
  }

  /**
   * Native 模式上传：通过 Bridge 告知 Native 层执行上传
   * @param pickedFile NativeFilePickerPlugin 返回的文件信息
   * @param targetDir 上传目标目录
   */
  async startNativeUpload(pickedFile: PickedFile, targetDir: string): Promise<void> {
    if (!this._bridge) return

    const info: TransferInfo = {
      id: `pending_${Date.now()}`, // 临时 ID，Native 会分配真正的 transfer_id
      name: pickedFile.name,
      direction: 'upload',
      totalSize: pickedFile.size,
      transferredSize: 0,
      status: 'pending',
      startedAt: Date.now(),
    }
    this._addTransfer(info)

    this._bridge.sendTransferRequest({
      action: 'start_upload',
      content_uri: pickedFile.uri,
      file_name: pickedFile.name,
      file_size: pickedFile.size,
      target_dir: targetDir,
      store_key: this._storeKey,
    })
    // 状态更新通过 FRAME_TRANSFER_SYNC 回来，Native 会发送真正的 transfer_id
    // 临时 pending entry 会在收到 sync 时被替换
  }

  cancelTransfer(id: string): void {
    const t = this._transfers.find(t => t.id === id)
    this._updateTransfer(id, { status: 'cancelled' })
    const activeChannel = this._activeChannels.get(id)
    if (activeChannel) {
      activeChannel.close()
      this._activeChannels.delete(id)
    } else if (t && isNativeApp() && this._bridge) {
      if (t.direction === 'download') {
        this._bridge.sendTransferRequest({ action: 'cancel_download', transfer_id: id })
      } else if (t.direction === 'upload') {
        this._bridge.sendTransferRequest({ action: 'cancel_upload', transfer_id: id })
      }
    }
    setTimeout(() => this._removeTransfer(id), 1000)
  }

  dismissTransfer(id: string): void {
    this._removeTransfer(id)
  }

  retryTransfer(id: string): void {
    const t = this._transfers.find(t => t.id === id)
    if (!t) return
    this._removeTransfer(id)
    if (t.direction === 'download' && t.filePath) {
      this.startDownload(t.filePath).catch(() => {})
    } else if (t.direction === 'upload' && t.file && t.targetDir) {
      this.startUpload(t.file, t.targetDir).catch(() => {})
    }
  }

  // ========== useSyncExternalStore 接口 ==========

  subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }

  getSnapshot(): FileTransferSnapshot {
    if (this._cachedSnapshotVersion === this._snapshotVersion && this._cachedSnapshot) {
      return this._cachedSnapshot
    }
    this._cachedSnapshot = {
      transfers: this._transfers,
      hasActiveTransfers: this._transfers.some(
        t => t.status === 'pending' || t.status === 'transferring'
      ),
    }
    this._cachedSnapshotVersion = this._snapshotVersion
    return this._cachedSnapshot
  }

  // ========== 内部方法 ==========

  /**
   * 处理 Native 传输同步数据
   * 更新/添加对应 TransferInfo，completed 3s 后自动移除
   */
  private _handleTransferSync(data: TransferSyncPayload): void {
    if (!data.transfers) return

    // 只处理属于本 store 的传输（向后兼容：无 storeKey 的条目也接受）
    const myTransfers = data.transfers.filter(
      t => !t.storeKey || t.storeKey === this._storeKey
    )

    // Remove pending placeholder entries (id starts with "pending_") when real native entries arrive
    const hasRealUploads = myTransfers.some(t => t.direction === 'upload' && !t.id.startsWith('pending_'))
    if (hasRealUploads) {
      const pendingPlaceholders = this._transfers.filter(t => t.id.startsWith('pending_') && t.direction === 'upload')
      for (const p of pendingPlaceholders) {
        this._removeTransfer(p.id)
      }
    }

    for (const nt of myTransfers) {
      const existing = this._transfers.find(t => t.id === nt.id)
      if (existing) {
        // 更新已有传输
        this._updateTransfer(nt.id, {
          transferredSize: nt.transferredSize,
          status: nt.status as TransferInfo['status'],
          error: nt.error,
        })
      } else {
        // 新传输（Bridge 重连后可能出现）
        const info: TransferInfo = {
          id: nt.id,
          name: nt.name,
          direction: nt.direction,
          totalSize: nt.totalSize,
          transferredSize: nt.transferredSize,
          status: nt.status as TransferInfo['status'],
          startedAt: nt.startedAt,
          filePath: nt.filePath,
          error: nt.error,
        }
        this._addTransfer(info)
      }

      // completed 的传输 3s 后自动移除
      if (nt.status === 'completed') {
        this._notifyComplete(nt.id)
        setTimeout(() => this._removeTransfer(nt.id), 3000)
      }
      // failed 的传输保留显示错误
    }
  }

  private _addTransfer(info: TransferInfo): void {
    this._transfers = [...this._transfers, info]
    this._notify()
  }

  private _updateTransfer(id: string, updates: Partial<TransferInfo>): void {
    this._transfers = this._transfers.map(t =>
      t.id === id ? { ...t, ...updates } : t
    )
    this._notify()
  }

  private _removeTransfer(id: string): void {
    this._transfers = this._transfers.filter(t => t.id !== id)
    this._notify()
  }

  private _notifyComplete(id: string): void {
    const t = this._transfers.find(t => t.id === id)
    if (t) this.onTransferComplete?.(t)
  }

  private _notify(): void {
    this._snapshotVersion++
    for (const fn of this._listeners) {
      fn()
    }
  }

  private _doUpload(
    transport: WebRTCTransport,
    fileApi: FileApi,
    transferId: string,
    file: File,
    startOffset: number,
    chunkSize: number,
  ): Promise<string> {
    const dc = transport.createFileChannel(transferId)
    if (!dc) {
      this._updateTransfer(transferId, { status: 'failed', error: '无法创建传输通道' })
      return Promise.reject(new Error('无法创建传输通道'))
    }

    return new Promise<string>((resolve, reject) => {
      dc.binaryType = 'arraybuffer'
      dc.bufferedAmountLowThreshold = 256 * 1024

      let finished = false
      let uploadProgressTimer: ReturnType<typeof setTimeout> | null = null
      let lastReportedOffset = startOffset
      const cleanup = () => {
        if (uploadProgressTimer) clearTimeout(uploadProgressTimer)
        uploadProgressTimer = null
      }
      const fail = (error: unknown, fallback: string) => {
        if (finished) return
        finished = true
        cleanup()
        const message = error instanceof Error ? error.message : fallback
        this._updateTransfer(transferId, { status: 'failed', error: message })
        reject(error instanceof Error ? error : new Error(message))
        dc.close()
      }
      const flushUploadProgress = (offset: number) => {
        lastReportedOffset = offset
        if (uploadProgressTimer) return
        uploadProgressTimer = setTimeout(() => {
          uploadProgressTimer = null
          if (!finished) this._updateTransfer(transferId, { transferredSize: lastReportedOffset })
        }, 200)
      }

      dc.onopen = async () => {
        this._updateTransfer(transferId, { status: 'transferring' })
        try {
          let offset = startOffset
          let chunkNum = Math.floor(startOffset / chunkSize)

          while (offset < file.size) {
            if (finished) return
            const end = Math.min(offset + chunkSize, file.size)
            const chunkData = new Uint8Array(await file.slice(offset, end).arrayBuffer())
            const frame = new Uint8Array(5 + chunkData.length)
            frame[0] = FRAME_DATA
            new DataView(frame.buffer).setUint32(1, chunkNum, false)
            frame.set(chunkData, 5)

            while (dc.bufferedAmount > 1024 * 1024) {
              await new Promise<void>(resume => {
                const handler = () => {
                  dc.removeEventListener('bufferedamountlow', handler)
                  resume()
                }
                dc.addEventListener('bufferedamountlow', handler)
              })
              if (finished) return
            }

            dc.send(frame)
            offset = end
            chunkNum++
            flushUploadProgress(offset)
          }

          const completeFrame = new Uint8Array(5)
          completeFrame[0] = FRAME_COMPLETE
          new DataView(completeFrame.buffer).setUint32(1, chunkNum, false)
          dc.send(completeFrame)

          // Let the ordered data channel drain before completing the upload
          // over the separate API channel.
          while (dc.bufferedAmount > 0) {
            await new Promise<void>(resume => setTimeout(resume, 10))
            if (finished) return
          }

          const completed = await fileApi.uploadComplete(transferId)
          if (finished) return
          finished = true
          cleanup()
          this._updateTransfer(transferId, { status: 'completed', transferredSize: file.size })
          this._notifyComplete(transferId)
          setTimeout(() => this._removeTransfer(transferId), 3000)
          resolve(completed.path)
          dc.close()
        } catch (error) {
          fail(error, '上传失败')
        }
      }

      dc.onerror = () => fail(new Error('传输通道错误'), '传输通道错误')
      dc.onclose = () => {
        if (!finished) fail(new Error('传输通道意外关闭'), '传输通道意外关闭')
      }
    })
  }

  /** 断点续传上传 */
  private async _resumeUpload(t: TransferInfo): Promise<void> {
    if (!this._transport || !this._fileApi || !t.file || !t.targetDir) return

    const transport = this._transport
    const fileApi = this._fileApi
    const file = t.file
    const targetPath = t.targetDir.endsWith('/')
      ? t.targetDir + file.name
      : t.targetDir + '/' + file.name

    this._updateTransfer(t.id, { status: 'pending', error: undefined })

    try {
      const init = await fileApi.uploadInit(targetPath, file.size, t.id)
      const { transfer_id, chunk_size, uploaded_offset } = init
      const startOffset = uploaded_offset || 0

      if (transfer_id !== t.id) {
        this._removeTransfer(t.id)
        const newInfo: TransferInfo = {
          ...t,
          id: transfer_id,
          transferredSize: startOffset,
          status: 'pending',
          error: undefined,
          startedAt: Date.now(),
        }
        this._addTransfer(newInfo)
      } else {
        this._updateTransfer(t.id, { transferredSize: startOffset })
      }

      void this._doUpload(transport, fileApi, transfer_id, file, startOffset, chunk_size || 64 * 1024).catch(() => {})
    } catch (err) {
      this._updateTransfer(t.id, {
        status: 'failed',
        error: err instanceof Error ? err.message : '续传初始化失败',
      })
    }
  }
}
