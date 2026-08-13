/**
 * 统一 App Provider
 * 初始化所有 State Layer 管理器，通过 Context 提供给 React 组件树
 */

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { NativeConnectionStoreManager } from '../state/NativeConnectionStoreManager'
import { NativeGoEngineBackend, WailsGoEngineBackend, WasmGoEngineBackend } from '../state/GoEngineBackend'
import { NetworkStateManager } from '../state/NetworkStateManager'
import { AuthManager } from '../state/AuthManager'
import { ForegroundServiceManager } from '../state/ForegroundServiceManager'
import { eventBus } from '../state/EventBus'
import { migrateFromLocalStorage } from '../lib/storage'
import { isNativeApp, isWailsApp } from '../lib/platform'

export interface AppContextValue {
  storeManager: NativeConnectionStoreManager
  networkStateManager: NetworkStateManager
  authManager: AuthManager
  foregroundServiceManager: ForegroundServiceManager
}

const AppContext = createContext<AppContextValue | null>(null)

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}

export function AppProvider({ children }: { children: ReactNode }) {
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const managersRef = useRef<{
    storeManager: NativeConnectionStoreManager
    networkStateManager: NetworkStateManager
    authManager: AuthManager
    foregroundServiceManager: ForegroundServiceManager
    engineKind: 'native' | 'wails' | 'wasm'
  } | null>(null)

  if (!managersRef.current) {
    const useNative = isNativeApp()
    const useWails = isWailsApp()
    const engineKind = useNative ? 'native' : useWails ? 'wails' : 'wasm'
    const backend = useNative
      ? new NativeGoEngineBackend()
      : useWails
        ? new WailsGoEngineBackend()
        : new WasmGoEngineBackend()
    managersRef.current = {
      storeManager: new NativeConnectionStoreManager(backend),
      networkStateManager: new NetworkStateManager(),
      authManager: AuthManager.getInstance(),
      foregroundServiceManager: new ForegroundServiceManager(),
      engineKind,
    }
    console.log(`[AppContext] Using Go connection engine (${engineKind})`)
  }

  const { storeManager, networkStateManager, authManager, foregroundServiceManager } =
    managersRef.current

  useEffect(() => {
    // React StrictMode immediately remounts effects in development. Defer the
    // destructive teardown so that simulated unmount can reuse the Go engine.
    if (destroyTimerRef.current) {
      clearTimeout(destroyTimerRef.current)
      destroyTimerRef.current = null
    }

    // 迁移旧 localStorage 数据到 Capacitor Preferences（仅原生环境首次执行）
    migrateFromLocalStorage().catch(() => {})

    // 初始化网络状态管理器
    networkStateManager.init()

    // 核心：将网络状态变化桥接到 ConnectionStoreManager
    const unsubNetwork = networkStateManager.subscribe((curr, prev) => {
      storeManager.onNetworkStateChange(curr, prev)
      // App 恢复时通知各页面刷新数据（冻结期间事件可能丢失）
      if (curr.resumeType || curr.jsFrozenRecovery) {
        eventBus.emit('app:resume', {})
      }
    })

    foregroundServiceManager.init().catch(() => {})

    return () => {
      unsubNetwork()
      destroyTimerRef.current = setTimeout(() => {
        storeManager.destroy()
        networkStateManager.destroy()
        foregroundServiceManager.destroy()
        destroyTimerRef.current = null
      }, 0)
    }
  }, [storeManager, networkStateManager, foregroundServiceManager])

  const value: AppContextValue = {
    storeManager,
    networkStateManager,
    authManager,
    foregroundServiceManager,
  }

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}
