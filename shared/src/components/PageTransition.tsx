import { lazy, Suspense, useRef, useState, useEffect, useCallback } from 'react'
import {
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigationType,
  matchPath,
} from 'react-router-dom'
import HomePage from '../pages/HomePage'
import DesktopTerminalPrototype, { DesktopTerminalWorkspace } from '../pages/DesktopTerminalPrototype'
import DesktopServerEntry from '../pages/DesktopServerEntry'
import { isNativeApp } from '../lib/platform'
import { isDesktopTarget } from '../lib/runtimeTarget'

const DirectAuthPage = lazy(() => import('../pages/DirectAuthPage'))
const WelcomePage = lazy(() => import('../pages/WelcomePage'))
const Dashboard = lazy(() => import('../pages/Dashboard'))
const TerminalPage = lazy(() => import('../pages/TerminalPage'))
const Settings = lazy(() => import('../pages/Settings'))
const LoginPage = lazy(() => import('../pages/LoginPage'))
const RegisterPage = lazy(() => import('../pages/RegisterPage'))
const ScanPage = lazy(() => import('../pages/ScanPage'))

/** 路由层级映射 */
const ROUTE_PATTERNS: [string, number][] = [
  ['/', 1],
  ['/settings', 1],
  ['/login', 2],
  ['/register', 2],
  ['/welcome', 2],
  ['/scan', 2],
  ['/s/:serverId', 2],
  ['/s/:serverId/t/:paneId', 3],
  ['/s/:serverId/terminal/:paneId', 3],
  ['/terminal-ref/:paneId', 3],
  ['/terminal/:paneId', 3],
  ['/test/webrtc', 2],
  ['/desktop-prototype', 1],
]

function getRouteLayer(pathname: string): number {
  for (const [pattern, layer] of ROUTE_PATTERNS) {
    if (matchPath(pattern, pathname)) return layer
  }
  return 1
}

/** 判断路径是否为 terminal 页面 */
function isTerminalRoute(pathname: string): boolean {
  return pathname === '/desktop-prototype' || pathname.includes('/terminal/') || pathname.includes('/terminal-ref/') || /\/s\/[^/]+\/t\//.test(pathname)
}

type Direction = 'push' | 'pop' | 'none'

const DURATION = 280
const EASING = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'

export default function PageTransition() {
  const location = useLocation()
  const navType = useNavigationType()

  const prevLocationRef = useRef(location)
  const [pages, setPages] = useState([
    { key: location.key, location, direction: 'none' as Direction },
  ])
  const [animating, setAnimating] = useState(false)

  const getDirection = useCallback(
    (from: string, to: string, type: string): Direction => {
      if (type === 'REPLACE') return 'none'
      const fromLayer = getRouteLayer(from)
      const toLayer = getRouteLayer(to)
      if (toLayer > fromLayer) return 'push'
      if (toLayer < fromLayer) return 'pop'
      if (type === 'POP') return 'pop'
      return 'none'
    },
    [],
  )

  useEffect(() => {
    const prev = prevLocationRef.current
    if (prev.key === location.key) return
    prevLocationRef.current = location

    const dir = getDirection(prev.pathname, location.pathname, navType)

    if (dir === 'none') {
      setPages([{ key: location.key, location, direction: 'none' }])
      return
    }

    // 双页面栈：保留旧页面 + 新页面
    setPages([
      { key: prev.key, location: prev, direction: dir },
      { key: location.key, location, direction: dir },
    ])
    setAnimating(true)

    const timer = setTimeout(() => {
      setAnimating(false)
      setPages([{ key: location.key, location, direction: 'none' }])
    }, DURATION)

    return () => clearTimeout(timer)
  }, [location, navType, getDirection])

  const useFade =
    isTerminalRoute(location.pathname) ||
    isTerminalRoute(prevLocationRef.current.pathname)

  return (
    <div className="page-stack">
      {pages.map((page, i) => {
        const isOld = animating && i === 0 && pages.length === 2
        const isNew = animating && i === 1 && pages.length === 2
        const dir = page.direction

        let animClass = ''
        if (isOld && dir === 'push') {
          animClass = useFade ? 'page-fade-out' : 'page-exit-left'
        } else if (isOld && dir === 'pop') {
          animClass = useFade ? 'page-fade-out' : 'page-exit-right'
        } else if (isNew && dir === 'push') {
          animClass = useFade ? 'page-fade-in' : 'page-enter-right'
        } else if (isNew && dir === 'pop') {
          animClass = useFade ? 'page-fade-in' : 'page-enter-left'
        }

        return (
          <div
            key={page.key}
            className={`page-stack-layer ${animClass}`}
            style={
              animClass
                ? {
                    animationDuration: `${DURATION}ms`,
                    animationTimingFunction: EASING,
                  }
                : undefined
            }
          >
            <Suspense fallback={null}>
            <Routes location={page.location}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/"
                element={
                  isNativeApp() || isDesktopTarget ? <HomePage /> : <DirectAuthPage />
                }
              />
              <Route
                path="/welcome"
                element={isDesktopTarget ? <Navigate to="/" replace /> : <WelcomePage />}
              />
              <Route path="/scan" element={<ScanPage />} />
              <Route
                path="/s/:serverId"
                element={isDesktopTarget ? <DesktopServerEntry /> : <Dashboard />}
              />
              <Route
                path="/s/:serverId/t/:paneId"
                element={isDesktopTarget ? <DesktopTerminalWorkspace /> : <TerminalPage />}
              />
              <Route
                path="/s/:serverId/terminal/:paneId"
                element={isDesktopTarget ? <DesktopTerminalWorkspace /> : <TerminalPage />}
              />
              <Route
                path="/terminal/:paneId"
                element={<TerminalPage />}
              />
              <Route
                path="/terminal-ref/:paneId"
                element={<TerminalPage />}
              />
              <Route path="/settings" element={<Settings />} />
              <Route path="/desktop-prototype" element={<DesktopTerminalPrototype />} />
              {/* 旧路由兼容重定向 */}
              <Route
                path="/local/:serverId/*"
                element={<Navigate to="/" replace />}
              />
              <Route
                path="/hub/:serverId/*"
                element={<Navigate to="/" replace />}
              />
              <Route
                path="/servers/:serverId"
                element={<Navigate to="/" replace />}
              />
              <Route
                path="/server-setup"
                element={<Navigate to="/" replace />}
              />
            </Routes>
            </Suspense>
          </div>
        )
      })}
    </div>
  )
}
