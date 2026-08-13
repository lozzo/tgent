import { useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 统一的 App 返回导航 hook。
 * 每个页面声明自己的"逻辑父路径"，hook 负责：
 * 1. 拦截浏览器/Android 返回（popstate），导航到逻辑父路径
 * 2. 提供 goBack 函数供 UI 返回按钮调用
 *
 * @param parentPath 逻辑父路径，如 '/' 或 '/local/xxx'
 * @param options.onBeforeBack 返回前的回调（如释放连接），可选
 * @param options.onBack 返回拦截器，返回 true 表示已自行处理，不再导航
 */
export function useAppBack(
  parentPath: string,
  options?: { onBeforeBack?: () => void; onBack?: () => boolean }
) {
  const navigate = useNavigate()
  const optionsRef = useRef(options)
  optionsRef.current = options

  const goBack = useCallback(() => {
    if (optionsRef.current?.onBack?.()) return
    optionsRef.current?.onBeforeBack?.()
    navigate(parentPath, { replace: true })
  }, [navigate, parentPath])

  useEffect(() => {
    history.pushState(null, '', location.href)
    const onPopState = () => {
      goBack()
      history.pushState(null, '', location.href)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [goBack])

  return goBack
}
