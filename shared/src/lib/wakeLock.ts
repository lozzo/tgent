/**
 * Web Screen Wake Lock API 封装
 * 终端活跃时防止屏幕休眠
 */

let wakeLock: WakeLockSentinel | null = null

/** 请求屏幕保持唤醒 */
export async function acquire(): Promise<void> {
  if (wakeLock) return
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => {
        wakeLock = null
      })
    }
  } catch {
    // WakeLock 不可用或被拒绝，静默忽略
  }
}

/** 释放屏幕唤醒锁 */
export function release(): void {
  if (wakeLock) {
    wakeLock.release().catch(() => {})
    wakeLock = null
  }
}

let reacquireOnVisible = false
let listenerAdded = false

/** 请求屏幕保持唤醒（带 visibility 自动恢复） */
export async function acquireWithAutoReacquire(): Promise<void> {
  reacquireOnVisible = true
  if (!listenerAdded) {
    listenerAdded = true
    document.addEventListener('visibilitychange', () => {
      if (reacquireOnVisible && document.visibilityState === 'visible' && !wakeLock) {
        acquire().catch(() => {})
      }
    })
  }
  await acquire()
}

/** 释放屏幕唤醒锁（并停止自动恢复） */
export function releaseAndStopAutoReacquire(): void {
  reacquireOnVisible = false
  release()
}
