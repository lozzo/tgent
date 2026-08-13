import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { haptic, getWebToken } from '../lib/platform'
import { addOrUpdateByHubAgentId, findByHubAgentId } from '../lib/localServers'
import { Html5Qrcode } from 'html5-qrcode'
import { useAppBack } from '../hooks/useAppBack'
import { loadEd25519Key, decryptWithPairCode, bytesToBase64 } from '../api/crypto'
import { webApi } from '../api/client'
import { eventBus } from '../state/EventBus'
import { parseQRCode, hasLocalInfo, hasHubInfo, toServerData, toLocalOnlyServerData, probeAddresses } from '../lib/qrParser'

type ScanState = 'loading' | 'scanning' | 'connecting' | 'error' | 'manual'

const tryLoadPairKey = async (privateKeySeed: string) => {
  try {
    await loadEd25519Key(privateKeySeed)
  } catch (e) {
    console.warn('[scan] load Ed25519 key failed, saved seed will be used later:', e)
  }
}

const getErrorName = (e: unknown) => e instanceof DOMException ? e.name : ''

const CameraIcon = () => (
  <svg className="w-8 h-8 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
  </svg>
)

const Spinner = () => (
  <svg className="w-8 h-8 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
)

export default function ScanPage() {
  const navigate = useNavigate()
  const goBack = useAppBack('/')
  const [searchParams] = useSearchParams()
  const pairAgentId = searchParams.get('pairAgentId')
  const isPairMode = !!pairAgentId

  const [state, setState] = useState<ScanState>('loading')
  const [errorTitle, setErrorTitle] = useState('')
  const [errorDetail, setErrorDetail] = useState('')
  const [connectingHint, setConnectingHint] = useState('')
  const [manualAgentId, setManualAgentId] = useState('')
  const [manualPairCode, setManualPairCode] = useState('')
  const [hasCamera, setHasCamera] = useState<boolean | null>(null)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    startScan()
    return () => {
      mountedRef.current = false
      stopScan()
    }
  }, [])

  const handleBack = () => {
    haptic()
    stopScan()
    goBack()
  }

  const showError = (title: string, detail: string) => {
    if (!mountedRef.current) return
    setState('error')
    setErrorTitle(title)
    setErrorDetail(detail)
  }

  const startScan = async () => {
    setState('loading')
    setErrorTitle('')
    setErrorDetail('')

    await new Promise(r => setTimeout(r, 100))

    try {
      const cameras = await Html5Qrcode.getCameras()
      if (!mountedRef.current) return
      if (cameras.length === 0) {
        setHasCamera(false)
        setState('manual')
        return
      }

      setHasCamera(true)
      const scanner = new Html5Qrcode('qr-reader')
      scannerRef.current = scanner

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 }, aspectRatio: 1.0 },
        (decodedText) => {
          stopScan()
          if (isPairMode) handlePairScan(decodedText)
          else handleScanResult(decodedText)
        },
        () => {},
      )

      if (mountedRef.current) setState('scanning')
    } catch (e: any) {
      scannerRef.current = null
      const msg = e?.toString?.() || ''
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        showError('需要相机权限', '请在系统设置中允许本应用使用相机，然后重试')
      } else if (msg.includes('NotFoundError') || msg.includes('DevicesNotFound')) {
        setHasCamera(false)
        setState('manual')
      } else if (msg.includes('NotReadableError') || msg.includes('TrackStartError')) {
        showError('无法打开相机', '请确认没有其他应用正在使用相机')
      } else {
        showError('无法启动相机', '请检查相机是否可用，或尝试重启应用')
      }
    }
  }

  const stopScan = () => {
    const scanner = scannerRef.current
    if (scanner) {
      scanner.stop().catch(() => {})
      try { scanner.clear() } catch {}
      scannerRef.current = null
    }
  }

  /** 配对模式：从 QR 码中提取 pairCode，直接完成配对 */
  const handlePairScan = async (content: string) => {
    haptic()
    try {
      const result = await parseQRCode(content)
      if (!result) {
        showError('无法识别此二维码', '请扫描 tgent 终端上显示的二维码')
        return
      }

      const pairCode = result.hub?.pairCode
      // QR 码中有 agentId 且不等于目标 → 报错
      if (result.hub?.agentId && result.hub.agentId !== pairAgentId) {
        showError('服务器不匹配', '此二维码对应的服务器与当前需要配对的服务器不同')
        return
      }
      if (!pairCode) {
        showError('未找到配对码', '此二维码不包含配对信息')
        return
      }

      // 直接执行配对
      await executePair(pairAgentId!, pairCode)
    } catch {
      showError('无法识别此二维码', '请扫描 tgent 终端上显示的二维码')
    }
  }

  /** 从 web API 获取 agent 名称 */
  const fetchAgentName = async (agentId: string): Promise<string> => {
    try {
      const agents = await webApi.listAgents()
      const agent = agents?.find(a => a.id === agentId)
      if (agent) return agent.name || agent.hostname || agentId
    } catch {}
    return agentId
  }

  /** 执行配对：下载加密密钥 → 解密 → 保存 → pairAgent */
  const executePair = async (agentId: string, pairCode: string) => {
    try {
      if (mountedRef.current) {
        setState('connecting')
        setConnectingHint('正在下载加密密钥...')
      }

      const encData = await webApi.getAgentEncryptedKey(agentId)
      if (!mountedRef.current) return

      if (mountedRef.current) setConnectingHint('正在解密密钥...')
      const seedBytes = await decryptWithPairCode(
        encData.encrypted_private_key,
        encData.key_nonce,
        pairCode,
        agentId,
      )
      const privateKeySeed = bytesToBase64(seedBytes)
      await tryLoadPairKey(privateKeySeed)

      if (mountedRef.current) setConnectingHint('正在保存...')
      // 查找已有记录，保留 name 等已有字段
      const existing = await findByHubAgentId(agentId)
      const name = existing?.name || await fetchAgentName(agentId)
      await addOrUpdateByHubAgentId({
        name,
        addr: existing?.addr || '',
        password: existing?.password || '',
        hubAgentId: agentId,
        hubAddr: existing?.hubAddr,
        localAddrs: existing?.localAddrs,
        pairCode,
        privateKeySeed,
      })

      if (await getWebToken()) {
        try { await webApi.pairAgent(agentId) } catch {}
      }

      navigate('/', { replace: true })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const errName = getErrorName(e)
      console.warn('[scan] pair failed:', errMsg, e)
      if (errMsg === 'session expired' || !(await getWebToken())) {
        showError('需要登录', '请先登录后再配对')
      } else if (errMsg.toLowerCase().includes('not found') || errMsg.includes('404')) {
        showError('Agent 不存在', '请检查 Agent ID 是否正确')
      } else if (errName === 'OperationError' || errMsg.includes('decrypt') || errMsg.includes('OperationError')) {
        showError('配对码错误', '解密失败，请检查配对码是否正确')
      } else if (errMsg === 'Failed to fetch') {
        showError('网络异常', '请检查网络后重试')
      } else {
        showError('配对失败', errMsg || '请重试')
      }
    }
  }

  /** 添加模式：先验证再保存 */
  const handleScanResult = async (content: string) => {
    haptic()

    try {
      const result = await parseQRCode(content)
      if (!result) {
        showError('无法识别此二维码', '请扫描 tgent 终端上显示的二维码')
        return
      }

      const hasLocal = hasLocalInfo(result)
      const hasHub = hasHubInfo(result)

      if (!hasLocal && !hasHub) {
        showError('二维码信息不完整', '缺少连接信息，请检查服务器配置')
        return
      }

      // ── local-only 模式：探测 → 保存 → 跳转 ──
      if (hasLocal && !hasHub) {
        const addrs = result.local!.addrs!
        if (mountedRef.current) {
          setState('connecting')
          setConnectingHint(`正在尝试 ${addrs.length} 个地址...`)
        }
        const workingAddr = await probeAddresses(addrs)
        if (!mountedRef.current) return
        const serverData = toLocalOnlyServerData(result, workingAddr)
        await saveServerData(serverData)
        if (!workingAddr) {
          eventBus.emit('toast:show', { message: '已保存服务器，连接时会再次尝试二维码中的地址', type: 'info' })
        }
        navigate('/', { replace: true })
        return
      }

      // ── 有 hub 信息 ──
      const agentId = result.hub!.agentId!
      const token = await getWebToken()

      // 未登录
      if (!token) {
        if (hasLocal) {
          // 只保存本地信息，不保存 hub
          const serverData = toLocalOnlyServerData(result, null)
          await saveServerData(serverData)
          eventBus.emit('toast:show', { message: '未登录，将仅使用本地模式连接', type: 'info' })
          navigate('/', { replace: true })
        } else {
          // hub-only + 未登录 → 不保存，提示登录
          showError('需要登录', '此二维码需要登录后才能使用')
        }
        return
      }

      // 已登录 → 验证所有权
      if (mountedRef.current) {
        setState('connecting')
        setConnectingHint('正在验证服务器...')
      }

      try {
        const encData = await webApi.getAgentEncryptedKey(agentId)
        if (!mountedRef.current) return

        // 有加密密钥 → 尝试解密
        if (result.hub?.pairCode) {
          try {
            if (mountedRef.current) setConnectingHint('正在解密密钥...')
            const seedBytes = await decryptWithPairCode(encData.encrypted_private_key, encData.key_nonce, result.hub.pairCode, agentId)
            const privateKeySeed = bytesToBase64(seedBytes)
            await tryLoadPairKey(privateKeySeed)

            // 解密成功 → 保存完整信息（含 hub + privateKeySeed）
            const serverData = toServerData(result, null)
            await saveServerData({ ...serverData, privateKeySeed })

            // 通知后端标记已配对
            try { await webApi.pairAgent(agentId) } catch {}
            navigate('/', { replace: true })
            return
          } catch (decryptErr) {
            console.warn('[scan] decrypt failed, saving with pairCode for later retry:', decryptErr)
            // 解密失败（pairCode 过期等）→ 保存含 pairCode 但不含 privateKeySeed
            const serverData = toServerData(result, null)
            await saveServerData(serverData)
            navigate('/', { replace: true })
            return
          }
        } else if (result.hub?.privateKey) {
          // 旧流程：直接从 QR 码加载私钥
          try { await loadEd25519Key(result.hub.privateKey) } catch {}
          const serverData = toServerData(result, null)
          await saveServerData(serverData)
          try { await webApi.pairAgent(agentId) } catch {}
          navigate('/', { replace: true })
          return
        }

        // 有加密密钥但 QR 码中没有 pairCode/privateKey → 保存含 hub 但标记需配对
        const serverData = toServerData(result, null)
        await saveServerData(serverData)
        navigate('/', { replace: true })
      } catch (e) {
        if (!mountedRef.current) return
        const errMsg = e instanceof Error ? e.message : String(e)

        // 404/not-found → 不是自己的 agent
        if (errMsg.toLowerCase().includes('not found') || errMsg.includes('404')) {
          if (hasLocal) {
            const serverData = toLocalOnlyServerData(result, null)
            await saveServerData(serverData)
            eventBus.emit('toast:show', { message: '不是您的服务器，将仅使用本地模式连接', type: 'info' })
            navigate('/', { replace: true })
          } else {
            showError('无法添加', '此服务器不属于当前账号')
          }
          return
        }

        // 网络错误
        if (errMsg === 'Failed to fetch') {
          showError('网络异常', '请求失败，请检查网络后重试')
          return
        }

        // 其他错误（session expired 等）
        if (errMsg === 'session expired') {
          showError('需要登录', '登录已过期，请重新登录后重试')
          return
        }

        showError('连接失败', errMsg || '请重试')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'Failed to fetch') {
        showError('网络异常', '请求失败，请检查网络后重试')
        return
      }
      showError('无法识别此二维码', '请扫描 tgent 终端上显示的二维码')
    }
  }

  /** 保存服务器数据到 IndexedDB，处理存储配额错误 */
  const saveServerData = async (serverData: Parameters<typeof addOrUpdateByHubAgentId>[0]) => {
    try {
      await addOrUpdateByHubAgentId(serverData)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'QuotaExceededError') {
        showError('保存失败', '本地存储空间不足，请清理后重试')
        throw err
      }
      throw err
    }
  }

  const handleManualPair = async (agentId: string, pairCode: string) => {
    haptic()
    if (!agentId.trim() || !pairCode.trim()) return

    try {
      if (mountedRef.current) {
        setState('connecting')
        setConnectingHint('正在下载加密密钥...')
      }

      // 下载加密密钥
      const encData = await webApi.getAgentEncryptedKey(agentId.trim())
      if (!mountedRef.current) return

      // 用配对码 + PBKDF2 派生密钥解密
      const seedBytes = await decryptWithPairCode(
        encData.encrypted_private_key,
        encData.key_nonce,
        pairCode.trim(),
        agentId.trim(),
      )
      const privateKeySeed = bytesToBase64(seedBytes)
      await tryLoadPairKey(privateKeySeed)

      // 保存服务器信息
      if (mountedRef.current) setConnectingHint('正在保存...')
      const existing = await findByHubAgentId(agentId.trim())
      const name = existing?.name || await fetchAgentName(agentId.trim())
      await addOrUpdateByHubAgentId({
        name,
        addr: existing?.addr || '',
        password: existing?.password || '',
        hubAgentId: agentId.trim(),
        hubAddr: existing?.hubAddr,
        localAddrs: existing?.localAddrs,
        pairCode: pairCode.trim(),
        privateKeySeed,
      })

      // 标记已配对
      if (await getWebToken()) {
        try {
          await webApi.pairAgent(agentId.trim())
        } catch (e) {
          console.warn('[scan] pairAgent failed:', e)
        }
      }

      navigate('/', { replace: true })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const errName = getErrorName(e)
      console.warn('[scan] manual pair failed:', errMsg, e)
      if (errMsg === 'session expired' || !(await getWebToken())) {
        showError('需要登录', '请先登录后再配对')
      } else if (errMsg.toLowerCase().includes('not found') || errMsg.includes('404')) {
        showError('Agent 不存在', '请检查 Agent ID 是否正确')
      } else if (errName === 'OperationError' || errMsg.includes('decrypt') || errMsg.includes('OperationError')) {
        showError('配对码错误', '解密失败，请检查配对码是否正确')
      } else if (errMsg === 'Failed to fetch') {
        showError('网络异常', '请检查网络后重试')
      } else {
        showError('配对失败', errMsg || '请检查输入后重试')
      }
    }
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col safe-top safe-x">
      <style>{`
        #qr-reader {
          width: min(78vw, 280px) !important;
          height: min(78vw, 280px) !important;
          aspect-ratio: 1 / 1 !important;
          overflow: hidden !important;
          border: none !important;
        }
        #qr-reader > div,
        #qr-reader__scan_region,
        #qr-reader__scan_region > div,
        #qr-reader video,
        #qr-reader canvas {
          width: 100% !important;
          height: 100% !important;
        }
        #qr-reader video,
        #qr-reader canvas {
          object-fit: cover !important;
        }
        #qr-reader img { display: none; }
      `}</style>

      {/* 顶栏 */}
      <header className="shrink-0 flex items-center gap-2 px-2 py-2 z-10">
        <button onClick={handleBack} className="w-9 h-9 flex items-center justify-center rounded-lg text-white/70 active:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h1 className="text-base font-medium text-white">{isPairMode ? '扫码配对' : '扫码添加服务器'}</h1>
      </header>

      {/* 扫描区域 */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {state === 'error' ? (
          <div className="text-center max-w-[280px]">
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-5">
              <CameraIcon />
            </div>
            <p className="text-white text-[17px] font-medium mb-2">{errorTitle}</p>
            <p className="text-white/50 text-[14px] mb-8 leading-relaxed">{errorDetail}</p>
            <div className="flex gap-3 justify-center">
              {errorTitle === '需要登录' ? (
                <button onClick={() => { haptic(); navigate('/login', { replace: true }) }} className="flex-1 py-3 rounded-xl bg-purple-600 text-white text-[15px] font-medium active:bg-purple-700 transition-colors">
                  去登录
                </button>
              ) : (
                <button onClick={() => { haptic(); stopScan(); setState('manual') }} className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700 transition-colors">
                  手动输入
                </button>
              )}
              {hasCamera !== false && errorTitle !== '需要登录' && (
                <button onClick={() => { haptic(); startScan() }} className="flex-1 py-3 rounded-xl bg-white/10 text-white text-[15px] active:bg-white/20 transition-colors">
                  重试扫码
                </button>
              )}
              <button onClick={handleBack} className="flex-1 py-3 rounded-xl bg-white/10 text-white text-[15px] active:bg-white/20 transition-colors">
                返回
              </button>
            </div>
          </div>
        ) : state === 'connecting' ? (
          <div className="text-center max-w-[280px]">
            <div className="w-16 h-16 rounded-full bg-blue-500/15 flex items-center justify-center mx-auto mb-5">
              <Spinner />
            </div>
            <p className="text-white text-[17px] font-medium mb-2">正在连接服务器</p>
            <p className="text-white/50 text-[14px]">{connectingHint}</p>
          </div>
        ) : (
          <>
            <div id="qr-reader" className="rounded-2xl overflow-hidden bg-white/5" />
            {state === 'scanning' && <p className="text-white/60 text-[15px] mt-5">{isPairMode ? '扫描终端上的二维码' : '将二维码放入框内'}</p>}
            {state === 'loading' && <p className="text-white/40 text-[14px] mt-5">正在启动相机...</p>}
            {(state === 'scanning' || state === 'loading') && (
              <button onClick={() => { haptic(); stopScan(); setState('manual') }} className="mt-6 px-4 py-2 rounded-lg bg-white/10 text-white/70 text-[14px] active:bg-white/20 transition-colors">
                {isPairMode ? '手动输入配对码' : '手动输入'}
              </button>
            )}
          </>
        )}
        {state === 'manual' && isPairMode && (
          <div className="w-full max-w-[320px] text-center">
            <p className="text-white text-[17px] font-medium mb-4">输入配对码</p>
            <p className="text-white/50 text-[13px] mb-4">输入终端中显示的 Pair Code</p>
            <input
              value={manualPairCode}
              onChange={(e) => setManualPairCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && manualPairCode.trim()) { haptic(); executePair(pairAgentId!, manualPairCode.trim()) } }}
              placeholder="Pair Code"
              className="w-full px-3 py-2.5 rounded-xl bg-white/10 text-white text-[14px] placeholder-white/30 border border-white/10 focus:border-blue-500/50 focus:outline-none font-mono tracking-wider"
              autoFocus
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => { haptic(); executePair(pairAgentId!, manualPairCode.trim()) }}
                disabled={!manualPairCode.trim()}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700 transition-colors disabled:opacity-40"
              >
                配对
              </button>
              {hasCamera !== false && (
                <button onClick={() => { haptic(); setManualPairCode(''); startScan() }} className="flex-1 py-3 rounded-xl bg-white/10 text-white text-[15px] active:bg-white/20 transition-colors">
                  扫码
                </button>
              )}
            </div>
          </div>
        )}
        {state === 'manual' && !isPairMode && (
          <div className="w-full max-w-[320px] text-center">
            <p className="text-white text-[17px] font-medium mb-4">手动配对</p>
            <p className="text-white/50 text-[13px] mb-4">输入终端中显示的 Agent ID 和 Pair Code</p>
            <input
              value={manualAgentId}
              onChange={(e) => setManualAgentId(e.target.value)}
              placeholder="Agent ID"
              className="w-full px-3 py-2.5 rounded-xl bg-white/10 text-white text-[14px] placeholder-white/30 border border-white/10 focus:border-blue-500/50 focus:outline-none mb-3"
              autoFocus
            />
            <input
              value={manualPairCode}
              onChange={(e) => setManualPairCode(e.target.value)}
              placeholder="Pair Code"
              className="w-full px-3 py-2.5 rounded-xl bg-white/10 text-white text-[14px] placeholder-white/30 border border-white/10 focus:border-blue-500/50 focus:outline-none font-mono tracking-wider"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => handleManualPair(manualAgentId, manualPairCode)}
                disabled={!manualAgentId.trim() || !manualPairCode.trim()}
                className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700 transition-colors disabled:opacity-40"
              >
                配对
              </button>
              {hasCamera !== false && (
                <button onClick={() => { haptic(); setManualAgentId(''); setManualPairCode(''); startScan() }} className="flex-1 py-3 rounded-xl bg-white/10 text-white text-[15px] active:bg-white/20 transition-colors">
                  扫码
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
