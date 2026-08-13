import type { ProviderTopology } from '../api/types'
import TopologyList from './TopologyList'

interface Props {
  open: boolean
  providerId?: string
  topologies: ProviderTopology[]
  currentTerminalId?: string
  onClose: () => void
  onSelectTerminal: (terminalId: string) => void
}

export default function TerminalTopologySwitcher({ open, providerId, topologies, currentTerminalId, onClose, onSelectTerminal }: Props) {
  if (!open) return null
  const providerTopologies = providerId
    ? topologies.filter(topology => topology.provider.id === providerId)
    : topologies

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0" style={{ backgroundColor: 'var(--color-bg-overlay)' }} />
      <div
        className="relative w-full max-w-lg bg-surface rounded-t-2xl overflow-hidden animate-slide-up"
        style={{ maxHeight: '70vh', paddingBottom: 'env(safe-area-inset-bottom)' }}
        onClick={event => event.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface z-10 px-4 pt-3 pb-3 border-b border-t-border-subtle">
          <div className="w-10 h-1 rounded-full bg-t-border mx-auto mb-3" />
          <span className="text-t-primary text-[15px] font-medium">选择终端</span>
        </div>
        <div className="overflow-y-auto px-4 py-4" style={{ maxHeight: 'calc(70vh - 4rem)' }}>
          <TopologyList
            topologies={providerTopologies}
            groupProviders={false}
            currentTerminalId={currentTerminalId}
            onSelectTerminal={terminalId => {
              onSelectTerminal(terminalId)
              onClose()
            }}
          />
          {providerTopologies.every(topology => topology.nodes.length === 0) && (
            <div className="text-center py-8 text-t-muted text-sm">无可用终端</div>
          )}
        </div>
      </div>
    </div>
  )
}
