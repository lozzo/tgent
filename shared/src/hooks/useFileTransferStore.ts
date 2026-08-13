/**
 * useFileTransferStore — 文件传输状态 hook
 *
 * 基于 useSyncExternalStore，消费 FileTransferStore。
 */

import { useSyncExternalStore, useCallback, useEffect, useState } from 'react'
import { useAppContext } from '../contexts/AppContext'
import { findLocalServerById } from '../lib/localServers'
import type { FileTransferSnapshot } from '../state/FileTransferStore'
import type { TransferInfo } from '../types/files'
import type { PickedFile } from '../plugins/nativeFilePicker'

const DIRECT_SERVER_ID = '__direct__'

export interface FileTransferActions {
  startDownload: (path: string) => Promise<void>
  startUpload: (file: File, targetDir: string) => Promise<void>
  startNativeUpload: (pickedFile: PickedFile, targetDir: string) => Promise<void>
  cancelTransfer: (id: string) => void
  dismissTransfer: (id: string) => void
  retryTransfer: (id: string) => void
}

/** 单 server 的传输状态（Dashboard/FileManager 使用） */
export function useFileTransferStore(serverId?: string): FileTransferSnapshot & FileTransferActions {
  const { storeManager } = useAppContext()
  const resolvedId = serverId || DIRECT_SERVER_ID

  const [resolvedType, setResolvedType] = useState<'local' | 'hub'>('local')

  useEffect(() => {
    if (resolvedId === DIRECT_SERVER_ID) {
      setResolvedType('local')
      return
    }
    findLocalServerById(resolvedId).then(local => {
      setResolvedType(local ? 'local' : 'hub')
    })
  }, [resolvedId])

  const ftStore = storeManager.getFileTransferStore(resolvedType, resolvedId)

  const subscribe = useCallback(
    (callback: () => void) => ftStore.subscribe(callback),
    [ftStore],
  )

  const getSnapshot = useCallback(
    () => ftStore.getSnapshot(),
    [ftStore],
  )

  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const actions: FileTransferActions = {
    startDownload: useCallback((path: string) => ftStore.startDownload(path), [ftStore]),
    startUpload: useCallback((file: File, targetDir: string) => ftStore.startUpload(file, targetDir), [ftStore]),
    startNativeUpload: useCallback((pickedFile: PickedFile, targetDir: string) => ftStore.startNativeUpload(pickedFile, targetDir), [ftStore]),
    cancelTransfer: useCallback((id: string) => ftStore.cancelTransfer(id), [ftStore]),
    dismissTransfer: useCallback((id: string) => ftStore.dismissTransfer(id), [ftStore]),
    retryTransfer: useCallback((id: string) => ftStore.retryTransfer(id), [ftStore]),
  }

  return { ...snapshot, ...actions }
}

export interface GlobalTransfersSnapshot {
  transfers: { serverId: string; transfer: TransferInfo }[]
  hasActive: boolean
}

/** 全局所有活跃传输（全局浮窗使用） */
export function useGlobalTransfers(): GlobalTransfersSnapshot {
  const { storeManager } = useAppContext()

  const subscribe = useCallback(
    (callback: () => void) => storeManager.subscribeGlobalTransfers(callback),
    [storeManager],
  )

  const getSnapshot = useCallback(
    () => storeManager.getGlobalTransfersSnapshot(),
    [storeManager],
  )

  return useSyncExternalStore(subscribe, getSnapshot)
}
