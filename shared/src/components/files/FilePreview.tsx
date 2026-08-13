import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { FileApi } from '../../api/fileClient'
import type { PreviewResponse } from '../../types/files'
import hljs from 'highlight.js/lib/core'
import 'highlight.js/styles/github-dark.min.css'

// 按需注册常用语言
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import go from 'highlight.js/lib/languages/go'
import rust from 'highlight.js/lib/languages/rust'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import c from 'highlight.js/lib/languages/c'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import bash from 'highlight.js/lib/languages/bash'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import ini from 'highlight.js/lib/languages/ini'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import scss from 'highlight.js/lib/languages/scss'
import less from 'highlight.js/lib/languages/less'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('go', go)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', c)
hljs.registerLanguage('css', css)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('scss', scss)
hljs.registerLanguage('less', less)

// 扩展名到 highlight.js 语言的映射
const extToLang: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  go: 'go', mod: 'go', sum: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  css: 'css',
  html: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql',
  md: 'markdown',
  ini: 'ini', conf: 'ini', cfg: 'ini', env: 'ini',
  scss: 'scss',
  less: 'less',
}
const nameToLang: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'bash',
  '.gitignore': 'bash',
  '.editorconfig': 'ini',
  '.env': 'ini',
}

interface Props {
  path: string
  fileApi: FileApi
  onClose: () => void
}

/** 写入系统剪贴板（静默失败） */
function copyToClipboard(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {})
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function FilePreview({ path, fileApi, onClose }: Props) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [leaving, setLeaving] = useState(false)

  // 阻止 touch 事件冒泡到 PullToRefresh（原生事件拦截）
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const stop = (e: Event) => e.stopPropagation()
    el.addEventListener('touchstart', stop, { passive: false })
    el.addEventListener('touchmove', stop, { passive: false })
    el.addEventListener('touchend', stop, { passive: false })
    return () => {
      el.removeEventListener('touchstart', stop)
      el.removeEventListener('touchmove', stop)
      el.removeEventListener('touchend', stop)
    }
  }, [])

  // 图片缩放
  const [scale, setScale] = useState(1)
  const lastPinchDist = useRef(0)

  useEffect(() => {
    setLoading(true)
    setError('')
    fileApi.preview(path).then(resp => {
      setPreview(resp)
    }).catch(err => {
      setError(err instanceof Error ? err.message : '预览失败')
    }).finally(() => {
      setLoading(false)
    })
  }, [path, fileApi])

  const handleClose = useCallback(() => {
    if (leaving) return
    setLeaving(true)
    setTimeout(onClose, 300)
  }, [onClose, leaving])

  // 图片双指缩放手势
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy)
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (lastPinchDist.current > 0) {
        const newScale = scale * (dist / lastPinchDist.current)
        setScale(Math.max(0.5, Math.min(5, newScale)))
      }
      lastPinchDist.current = dist
    }
  }, [scale])

  const handleTouchEnd = useCallback(() => {
    lastPinchDist.current = 0
  }, [])

  // 双击重置缩放
  const lastTap = useRef(0)
  const handleDoubleTap = useCallback(() => {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      setScale(s => s !== 1 ? 1 : 2)
    }
    lastTap.current = now
  }, [])

  const opacity = leaving ? 0 : 1

  // 语法高亮
  const highlightedLines = useMemo(() => {
    if (!preview?.is_text || preview.content == null) return null
    const fileName = preview.name.toLowerCase()
    const ext = fileName.split('.').pop() || ''
    const lang = nameToLang[fileName] || extToLang[ext]

    try {
      let result: string
      if (lang) {
        result = hljs.highlight(preview.content, { language: lang, ignoreIllegals: true }).value
      } else {
        result = hljs.highlightAuto(preview.content).value
      }
      return result.split('\n')
    } catch {
      return preview.content.split('\n')
    }
  }, [preview])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )
    }

    if (error) {
      return (
        <div className="text-center py-20 text-red-400 text-sm">{error}</div>
      )
    }

    if (!preview) return null

    // 文本预览
    if (preview.is_text && preview.content != null && highlightedLines) {
      return (
        <div className="overflow-auto flex-1 text-sm">
          <table className="w-full border-collapse">
            <tbody>
              {highlightedLines.map((line, i) => (
                <tr key={i} className="hover:bg-[var(--color-border-subtle)]/30">
                  <td className="text-right pr-3 pl-3 py-0 select-none text-t-muted/50 font-mono text-xs w-[1%] whitespace-nowrap align-top">
                    {i + 1}
                  </td>
                  <td
                    className="pr-4 py-0 font-mono whitespace-pre text-t-primary"
                    dangerouslySetInnerHTML={{ __html: line || '\n' }}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    // 文本文件超限
    if (preview.is_text && !preview.content) {
      return (
        <div className="text-center py-20 text-t-muted text-sm">
          文件太大（{formatSize(preview.size)}），无法预览，请下载查看
        </div>
      )
    }

    // 图片预览（支持缩放）
    if (preview.content_base64) {
      return (
        <div
          className="flex-1 flex items-center justify-center overflow-hidden"
          onClick={handleDoubleTap}
        >
          <img
            src={`data:${preview.mime_type};base64,${preview.content_base64}`}
            alt={preview.name}
            className="max-w-full max-h-full object-contain transition-transform duration-150"
            style={{ transform: `scale(${scale})` }}
            draggable={false}
          />
        </div>
      )
    }

    return (
      <div className="text-center py-20 text-t-muted text-sm">
        不支持预览此文件类型，请下载查看
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${leaving ? 'animate-overlay-out' : 'animate-overlay-in'}`}
        style={{ opacity }}
      />

      {/* 全屏内容 */}
      <div
        className={`relative z-10 flex flex-col h-full bg-[var(--color-bg-page)] ${leaving ? 'animate-preview-out' : 'animate-preview-in'}`}
      >

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-t-primary truncate">
              {preview?.name || path.split('/').pop()}
            </span>
            {preview && (
              <span className="text-xs text-t-muted shrink-0">{formatSize(preview.size)}</span>
            )}
          </div>
          <button
            onPointerUp={(e) => { e.stopPropagation(); handleClose() }}
            onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); handleClose() }}
            className="p-3 -mr-1 rounded-lg text-t-muted hover:text-t-primary hover:bg-[var(--color-border-subtle)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 文件路径 */}
        <div className="px-4 pb-2 flex items-center gap-2">
          <span className="text-xs text-t-muted truncate flex-1">{path}</span>
          <button
            onPointerUp={() => copyToClipboard(path)}
            className="text-xs text-blue-500 shrink-0 px-1.5 py-0.5 rounded active:opacity-70"
          >
            复制路径
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
