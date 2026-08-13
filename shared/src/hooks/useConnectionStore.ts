/**
 * useConnectionStore — useSyncExternalStore 封装
 * 替代原有的 useServerConnection
 */

import { useSyncExternalStore, useEffect, useState, useCallback } from 'react'
import { useAppContext } from '../contexts/AppContext'
import { findLocalServerById } from '../lib/localServers'
import type { ConnectionSnapshot } from '../state/connectionTypes'

/** direct 模式的虚拟 serverId */
const DIRECT_SERVER_ID = '__direct__'

export function useConnectionStore(serverId?: string): ConnectionSnapshot {
  const { storeManager } = useAppContext()
  const resolvedId = serverId || DIRECT_SERVER_ID

  // 异步推断 serverType
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

  const subscribe = useCallback(
    (callback: () => void) => storeManager.subscribe(resolvedType, resolvedId, callback),
    [storeManager, resolvedType, resolvedId],
  )

  const getSnapshot = useCallback(
    () => storeManager.getSnapshot(resolvedType, resolvedId),
    [storeManager, resolvedType, resolvedId],
  )

  return useSyncExternalStore(subscribe, getSnapshot)
}
