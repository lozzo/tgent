interface NetInfo {
  type: 'p2p' | 'relay' | 'unknown'
  localAddr?: string
  remoteAddr?: string
  candidateType?: string
  remoteCandidateType?: string
  rtt?: number
}

interface ConnectionInfoDialogProps {
  netInfo: NetInfo
  onClose: () => void
  onReconnect: () => void
}

export default function ConnectionInfoDialog({ netInfo, onClose, onReconnect }: ConnectionInfoDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-[var(--color-bg-card,#1c1c1e)] rounded-2xl p-5 mx-6 max-w-sm w-full shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-t-primary">网络连接</h3>
          <button onClick={onClose} className="text-t-muted p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${netInfo.type === 'p2p' ? 'bg-green-400' : netInfo.type === 'relay' ? 'bg-yellow-400' : 'bg-gray-400'}`} />
            <span className="text-t-secondary">连接方式</span>
            <span className="ml-auto text-t-primary font-medium">
              {netInfo.type === 'p2p' ? 'P2P 直连' : netInfo.type === 'relay' ? 'TURN 中转' : '未知'}
            </span>
          </div>
          {netInfo.rtt != null && (
            <div className="flex justify-between">
              <span className="text-t-secondary">延迟 (RTT)</span>
              <span className="text-t-primary">{netInfo.rtt} ms</span>
            </div>
          )}
          {netInfo.localAddr && (
            <div className="flex justify-between">
              <span className="text-t-secondary">本地地址</span>
              <span className="text-t-primary font-mono text-xs">{netInfo.localAddr}</span>
            </div>
          )}
          {netInfo.candidateType && (
            <div className="flex justify-between">
              <span className="text-t-secondary">本地候选类型</span>
              <span className="text-t-primary">{netInfo.candidateType}</span>
            </div>
          )}
          {netInfo.remoteAddr && (
            <div className="flex justify-between">
              <span className="text-t-secondary">远程地址</span>
              <span className="text-t-primary font-mono text-xs">{netInfo.remoteAddr}</span>
            </div>
          )}
          {netInfo.remoteCandidateType && (
            <div className="flex justify-between">
              <span className="text-t-secondary">远程候选类型</span>
              <span className="text-t-primary">{netInfo.remoteCandidateType}</span>
            </div>
          )}
        </div>
        <button
          onClick={() => { onClose(); onReconnect() }}
          className="mt-4 w-full py-2.5 rounded-xl bg-blue-500/15 text-blue-400 text-sm font-medium active:bg-blue-500/25 transition-colors"
        >
          重新连接
        </button>
      </div>
    </div>
  )
}
