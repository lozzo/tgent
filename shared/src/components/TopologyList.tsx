import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderTopology, TopologyNode } from '../api/types'
import { haptic } from '../lib/platform'

interface Props {
  topologies: ProviderTopology[]
  onSelectTerminal: (terminalId: string) => void
  groupProviders?: boolean
  currentTerminalId?: string
}

export default function TopologyList({ topologies, onSelectTerminal, groupProviders = true, currentTerminalId }: Props) {
  const defaultExpandedKeys = useMemo(() => {
    const keys: string[] = []
    const visit = (node: TopologyNode, scope: string) => {
      const nodeKey = `${scope}:${node.id}`
      if (node.children?.length) {
        keys.push(nodeKey)
        node.children.forEach(child => visit(child, nodeKey))
      }
    }
    topologies.forEach(topology => {
      const providerKey = `provider:${topology.provider.id}`
      keys.push(providerKey)
      topology.nodes.forEach(node => visit(node, `${providerKey}:node`))
    })
    return keys
  }, [topologies])
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultExpandedKeys),
  )
  const knownKeysRef = useRef(new Set(defaultExpandedKeys))

  useEffect(() => {
    const newKeys = defaultExpandedKeys.filter(key => !knownKeysRef.current.has(key))
    if (newKeys.length === 0) return
    newKeys.forEach(key => knownKeysRef.current.add(key))
    setExpanded(current => {
      const next = new Set(current)
      newKeys.forEach(key => next.add(key))
      return next
    })
  }, [defaultExpandedKeys])

  const toggle = (id: string) => {
    haptic()
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (topologies.length === 0) return null

  if (!groupProviders) {
    return (
      <div className="space-y-4" aria-label="终端会话">
        {topologies.flatMap(topology => topology.nodes.map(node => (
          <TopologyRow
            key={`${topology.provider.id}:${node.id}`}
            node={node}
            depth={0}
            scope={`provider:${topology.provider.id}:node`}
            expanded={expanded}
            onToggle={toggle}
            onSelectTerminal={onSelectTerminal}
            currentTerminalId={currentTerminalId}
          />
        )))}
      </div>
    )
  }

  return (
    <div className="space-y-6" aria-label="其他终端来源">
      {topologies.map(topology => {
        const providerKey = `provider:${topology.provider.id}`
        const open = expanded.has(providerKey)
        return (
          <section key={topology.provider.id}>
            <button
              type="button"
              onClick={() => toggle(providerKey)}
              className="w-full min-h-11 flex items-center gap-3 mb-2 text-left active:opacity-70"
              aria-expanded={open}
            >
              <ProviderMark kind={topology.provider.kind} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-t-primary truncate">
                  {topology.provider.name || topology.provider.kind}
                </span>
                <span className="block text-xs text-t-muted truncate">
                  {topology.error ? '暂时不可用' : (topology.provider.running ? `${topology.nodes.length} 个会话` : '未运行')}
                </span>
              </span>
              <Chevron open={open} />
            </button>
            {open && (
              <div className="space-y-4">
                {topology.nodes.map(node => (
                  <TopologyRow
                    key={node.id}
                    node={node}
                    depth={0}
                    scope={`${providerKey}:node`}
                    expanded={expanded}
                    onToggle={toggle}
                    onSelectTerminal={onSelectTerminal}
                    currentTerminalId={currentTerminalId}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function TopologyRow({ node, depth, scope, expanded, onToggle, onSelectTerminal, currentTerminalId }: {
  node: TopologyNode
  depth: number
  scope: string
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelectTerminal: (terminalId: string) => void
  currentTerminalId?: string
}) {
  const hasChildren = !!node.children?.length
  const nodeKey = `${scope}:${node.id}`
  const open = expanded.has(nodeKey)
  const isTerminal = !!node.terminal_id
  const isCurrent = isTerminal && node.terminal_id === currentTerminalId
  const activate = () => {
    if (isCurrent) return
    if (isTerminal) {
      haptic()
      onSelectTerminal(node.terminal_id!)
    } else if (hasChildren) {
      onToggle(nodeKey)
    }
  }

  const childCount = node.children?.length || 0
  const summary = node.kind === 'session'
    ? `${childCount} 个标签页`
    : node.kind === 'tab'
      ? `${childCount} 个窗格`
      : paneSummary(node)

  if (depth === 0) {
    return (
      <div className="rounded-2xl bg-[var(--color-border-subtle)] overflow-hidden">
        <button
          type="button"
          onClick={activate}
          disabled={!isTerminal && !hasChildren}
          className={`w-full min-h-11 flex items-center gap-3 px-4 py-3.5 text-left disabled:opacity-50 active:bg-[var(--color-border-subtle)] transition-colors ${isCurrent ? 'bg-blue-500/10' : ''}`}
          aria-expanded={hasChildren ? open : undefined}
          aria-current={isCurrent ? 'page' : undefined}
        >
          <NodeMark kind={node.kind} depth={depth} />
          <NodeText node={node} summary={summary} depth={depth} />
          {isCurrent && <CurrentBadge />}
          {hasChildren && <Chevron open={open} />}
        </button>
        {hasChildren && open && node.children!.map(child => (
          <TopologyRow
            key={child.id}
            node={child}
            depth={depth + 1}
            scope={nodeKey}
            expanded={expanded}
            onToggle={onToggle}
            onSelectTerminal={onSelectTerminal}
            currentTerminalId={currentTerminalId}
          />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className={depth === 1 ? 'ml-[4.25rem] h-px bg-t-border-subtle' : 'ml-[5.5rem] h-px bg-t-border-subtle'} />
      <button
        type="button"
        onClick={activate}
        disabled={!isTerminal && !hasChildren}
        className={`w-full min-h-11 flex items-center gap-3 pr-4 text-left disabled:opacity-50 active:bg-[var(--color-border-subtle)] transition-colors ${depth === 1 ? 'pl-8 py-3' : 'pl-14 py-3'} ${isCurrent ? 'bg-blue-500/10' : ''}`}
        aria-expanded={hasChildren ? open : undefined}
        aria-current={isCurrent ? 'page' : undefined}
      >
        <NodeMark kind={node.kind} depth={depth} />
        <NodeText node={node} summary={summary} depth={depth} />
        {isCurrent && <CurrentBadge />}
        {hasChildren && <Chevron open={open} />}
      </button>
      {hasChildren && open && node.children!.map(child => (
        <TopologyRow
          key={child.id}
          node={child}
          depth={depth + 1}
          scope={nodeKey}
          expanded={expanded}
          onToggle={onToggle}
          onSelectTerminal={onSelectTerminal}
          currentTerminalId={currentTerminalId}
        />
      ))}
    </div>
  )
}

function CurrentBadge() {
  return <span className="shrink-0 text-[11px] font-medium text-blue-300">当前</span>
}

function NodeText({ node, summary, depth }: { node: TopologyNode; summary: string; depth: number }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`block text-t-primary font-medium truncate ${depth === 0 ? 'text-[17px]' : depth === 1 ? 'text-[16px]' : 'text-[15px]'}`}>
        {node.name || node.metadata?.command || node.kind}
      </span>
      <span className="block text-[12px] text-t-muted mt-0.5 truncate">{summary}</span>
    </span>
  )
}

function paneSummary(node: TopologyNode): string {
  const parts = [node.metadata?.command]
  if (node.metadata?.columns && node.metadata?.rows) {
    parts.push(`${node.metadata.columns}×${node.metadata.rows}`)
  }
  if (node.metadata?.status === 'exited') parts.push('已退出')
  return parts.filter(Boolean).join(' · ') || '终端窗格'
}

function NodeMark({ kind, depth }: { kind: string; depth: number }) {
  if (depth === 0 || kind === 'session') {
    return (
      <span className="w-10 h-10 shrink-0 rounded-xl bg-indigo-500/15 flex items-center justify-center">
        <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.429 9.75m11.142 0 4.179 2.25L12 19.5l-9.75-5.25 4.179-2.25" /></svg>
      </span>
    )
  }
  if (depth === 1 || kind === 'tab' || kind === 'window') {
    return (
      <span className="w-8 h-8 shrink-0 rounded-lg bg-cyan-500/10 flex items-center justify-center">
        <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>
      </span>
    )
  }
  return (
    <span className="w-7 h-7 shrink-0 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
      <TerminalGlyph />
    </span>
  )
}

function ProviderMark({ kind }: { kind: string }) {
  const isZellij = kind.toLowerCase() === 'zellij'
  return (
    <span className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono text-xs font-semibold shrink-0 ${
      isZellij ? 'bg-emerald-500/15 text-emerald-400' : 'bg-violet-500/15 text-violet-300'
    }`}>
      {isZellij ? 'ZJ' : kind.slice(0, 2).toUpperCase()}
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`w-4 h-4 shrink-0 text-t-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
    </svg>
  )
}

function TerminalGlyph() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 8 4 4-4 4m6 0h6" />
    </svg>
  )
}
