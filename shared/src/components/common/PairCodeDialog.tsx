import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, LoaderCircle, X } from 'lucide-react'
import { haptic, getWebToken } from '../../lib/platform'
import { webApi } from '../../api/client'
import { loadEd25519Key, decryptWithPairCode, bytesToBase64 } from '../../api/crypto'
import { addOrUpdateByHubAgentId } from '../../lib/localServers'
import type { LocalServer } from '../../lib/localServers'

interface PairCodeDialogProps {
  open: boolean
  agentId: string
  agentName: string
  localServer?: LocalServer
  initialPairCode?: string
  onClose: () => void
  onPaired: () => void
  variant?: 'mobile' | 'desktop'
}

const tryLoadPairKey = async (privateKeySeed: string) => {
  try {
    await loadEd25519Key(privateKeySeed)
  } catch (e) {
    console.warn('[PairCodeDialog] load Ed25519 key failed, saved seed will be used later:', e)
  }
}

export default function PairCodeDialog({ open, agentId, agentName, localServer, initialPairCode, onClose, onPaired, variant = 'mobile' }: PairCodeDialogProps) {
  const navigate = useNavigate()
  const [pairCode, setPairCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const autoPairTriggered = useRef(false)
  const desktopDialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // 当 dialog 关闭时重置状态
  useEffect(() => {
    if (!open) {
      autoPairTriggered.current = false
      setPairCode('')
      setError('')
    }
  }, [open])

  // 接收 initialPairCode 时自动配对
  useEffect(() => {
    if (open && initialPairCode && !autoPairTriggered.current) {
      autoPairTriggered.current = true
      setPairCode(initialPairCode)
      handlePair(initialPairCode)
    }
  }, [open, initialPairCode])

  useEffect(() => {
    if (!open || variant !== 'desktop') return
    const focusFrame = requestAnimationFrame(() => desktopDialogRef.current?.querySelector<HTMLInputElement>('input')?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const dialog = desktopDialogRef.current
      if (!dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, variant])

  if (!open) return null

  const handlePair = async (codeOverride?: string) => {
    const code = (codeOverride || pairCode).trim()
    if (!code) return
    haptic()
    setLoading(true)
    setError('')

    try {
      const encData = await webApi.getAgentEncryptedKey(agentId)
      const seedBytes = await decryptWithPairCode(
        encData.encrypted_private_key,
        encData.key_nonce,
        code,
        agentId,
      )
      const privateKeySeed = bytesToBase64(seedBytes)
      await tryLoadPairKey(privateKeySeed)

      await addOrUpdateByHubAgentId({
        name: localServer?.name || agentName,
        addr: localServer?.addr || '',
        password: localServer?.password || '',
        hubAgentId: agentId,
        hubAddr: localServer?.hubAddr,
        localAddrs: localServer?.localAddrs,
        pairCode: code,
        privateKeySeed,
      })

      if (await getWebToken()) {
        try { await webApi.pairAgent(agentId) } catch {}
      }

      setPairCode('')
      onPaired()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const name = e instanceof DOMException ? e.name : ''
      if (msg === 'session expired' || !(await getWebToken())) {
        setError('登录已过期，请重新登录')
      } else if (name === 'OperationError' || msg.includes('decrypt') || msg.includes('OperationError')) {
        setError('配对码错误')
      } else if (msg === 'Failed to fetch') {
        setError('网络异常')
      } else {
        setError('配对失败')
      }
    } finally {
      setLoading(false)
    }
  }

  if (variant === 'desktop') {
    return (
      <div className="desktop-pairing-layer" onPointerDown={() => { if (!loading) onClose() }}>
        <div
          ref={desktopDialogRef}
          className="desktop-pairing-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="desktop-pairing-title"
          aria-busy={loading}
          onPointerDown={event => event.stopPropagation()}
        >
          <header>
            <span><KeyRound size={15} /><strong id="desktop-pairing-title">Pair agent</strong></span>
            <button type="button" onClick={onClose} disabled={loading} aria-label="Close pairing" title="Close"><X size={15} /></button>
          </header>
          <form onSubmit={event => { event.preventDefault(); void handlePair() }}>
            <div className="desktop-pairing-copy">
              <strong>{agentName}</strong>
              <small>Enter the Pair Code shown by this TGent agent.</small>
            </div>
            <label>
              <span>Pair code</span>
              <input
                value={pairCode}
                onChange={event => { setPairCode(event.target.value); setError('') }}
                placeholder="Pair Code"
                autoComplete="one-time-code"
                spellCheck={false}
                disabled={loading}
              />
            </label>
            {error && <p className="desktop-pairing-error" role="alert">{error}</p>}
            <footer>
              <button type="button" onClick={onClose} disabled={loading}>Cancel</button>
              <button type="submit" className="is-primary" disabled={!pairCode.trim() || loading}>
                {loading && <LoaderCircle size={13} className="is-spinning" aria-hidden="true" />}
                {loading ? 'Pairing' : 'Pair'}
              </button>
            </footer>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-[90%] max-w-sm bg-surface rounded-2xl px-5 py-6 animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-t-primary text-[18px] font-semibold mb-1">输入配对码</h3>
        <p className="text-t-muted text-[13px] mb-4">{agentName}</p>
        <input
          value={pairCode}
          onChange={(e) => { setPairCode(e.target.value); setError('') }}
          onKeyDown={(e) => { if (e.key === 'Enter' && pairCode.trim()) handlePair() }}
          placeholder="终端中显示的 Pair Code"
          className="w-full px-3 py-2.5 rounded-xl bg-elevated text-t-primary text-[15px] font-mono tracking-wider placeholder-t-muted border border-[var(--color-border-subtle)] focus:border-blue-500/50 focus:outline-none"
          autoFocus
          disabled={loading}
        />
        {error && <p className="text-red-400 text-[13px] mt-2">{error}</p>}
        <div className="flex gap-3 mt-4">
          <button
            onClick={() => { haptic(); setPairCode(''); setError(''); onClose() }}
            disabled={loading}
            className="flex-1 py-3 rounded-xl bg-elevated text-t-secondary text-[15px] font-medium active:bg-[var(--color-border)] disabled:opacity-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => handlePair()}
            disabled={!pairCode.trim() || loading}
            className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-[15px] font-medium active:bg-blue-700 transition-colors disabled:opacity-40"
          >
            {loading ? (
              <svg className="w-5 h-5 mx-auto animate-spin text-white/70" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : '配对'}
          </button>
        </div>
        <button
          onClick={() => { haptic(); setPairCode(''); setError(''); onClose(); navigate(`/scan?pairAgentId=${encodeURIComponent(agentId)}`) }}
          disabled={loading}
          className="w-full mt-3 py-2.5 text-t-muted text-[13px] active:text-t-secondary transition-colors"
        >
          扫码配对
        </button>
      </div>
    </div>
  )
}
