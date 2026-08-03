'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Clock, CornerDownLeft, FilePlus2, FileText, Loader2, Moon, Search, Settings } from 'lucide-react'
import { getRecent, type RecentItem } from './DocTracker'
import { useDialog } from './Dialog'

interface Props {
  open: boolean
  onClose: () => void
}

interface SearchHit {
  path: string
  title: string
  snippet: string
}

interface Row {
  kind: 'recent' | 'hit' | 'command'
  label: string
  sub?: string
  href?: string
  action?: () => void
}

function docHref(path: string) {
  return '/docs/' + path.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

export default function CommandPalette({ open, onClose }: Props) {
  const router = useRouter()
  const dialog = useDialog()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [recent, setRecent] = useState<RecentItem[]>([])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- 打开时重置面板状态是预期行为 */
      setQ('')
      setHits([])
      setCursor(0)
      setRecent(getRecent())
      /* eslint-enable react-hooks/set-state-in-effect */
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // 搜索（防抖）；空查询时 rows 不使用 hits，无需清空
  useEffect(() => {
    if (!open || !q.trim()) return
    const timer = setTimeout(async () => {
      setLoading(true)
      const res = await fetch('/api/search?q=' + encodeURIComponent(q.trim()))
      const data = await res.json().catch(() => ({ results: [] }))
      setHits(data.results ?? [])
      setLoading(false)
      setCursor(0)
    }, 220)
    return () => clearTimeout(timer)
  }, [q, open])

  const toggleTheme = useCallback(() => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem('gitmd-theme', next)
    window.dispatchEvent(new Event('gitmd-theme'))
    onClose()
  }, [onClose])

  const rows: Row[] = []
  if (!q.trim()) {
    recent.forEach((r) =>
      rows.push({ kind: 'recent', label: r.title, sub: r.path, href: docHref(r.path) }),
    )
    rows.push({ kind: 'command', label: '新建文档', sub: '命令', action: () => {
      onClose()
      dialog
        .prompt({
          title: '新建文档',
          message: '输入相对仓库根的路径，会自动补 .md 扩展名。',
          input: { placeholder: 'guide/intro.md' },
        })
        .then((p) => {
          if (p) router.push('/edit/' + (p.endsWith('.md') ? p : `${p}.md`).split('/').map(encodeURIComponent).join('/') + '?new=1')
        })
    } })
    rows.push({ kind: 'command', label: '切换深色 / 浅色', sub: '命令', action: toggleTheme })
    rows.push({ kind: 'command', label: '平台管理', sub: '命令', href: '/admin' })
  } else {
    const titleHits = hits.filter((h) => h.title.includes(q.trim()))
    const bodyHits = hits.filter((h) => !h.title.includes(q.trim()))
    titleHits.forEach((h) => rows.push({ kind: 'hit', label: h.title, sub: h.path, href: docHref(h.path) }))
    bodyHits.forEach((h) => rows.push({ kind: 'hit', label: h.title, sub: h.path, href: docHref(h.path) }))
  }

  function go(row: Row) {
    if (row.href) {
      onClose()
      router.push(row.href)
    } else if (row.action) {
      row.action()
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[cursor]
      if (row) go(row)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  if (!open) return null

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="全局搜索">
        <div className="palette-input-row">
          {loading ? <Loader2 size={16} className="palette-spin" /> : <Search size={16} />}
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="搜索文档、标题、正文…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="kbd">ESC</kbd>
        </div>

        <div className="palette-list" ref={listRef}>
          {!q.trim() && recent.length > 0 && <div className="palette-group">最近访问</div>}
          {rows.map((row, i) => {
            const isGroupStart =
              q.trim() && (i === 0 || rows[i - 1].kind !== row.kind)
            return (
              <div key={i}>
                {isGroupStart && row.kind === 'hit' && <div className="palette-group">文档</div>}
                {!q.trim() && i === recent.length && <div className="palette-group">命令</div>}
                <button
                  data-index={i}
                  className={`palette-item ${cursor === i ? 'active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(row)}
                >
                  {row.kind === 'recent' && <Clock size={14} />}
                  {row.kind === 'hit' && <FileText size={14} />}
                  {row.kind === 'command' && row.label.includes('主题') && <Moon size={14} />}
                  {row.kind === 'command' && row.label.includes('新建') && <FilePlus2 size={14} />}
                  {row.kind === 'command' && row.label.includes('管理') && <Settings size={14} />}
                  <span className="palette-item-label">{row.label}</span>
                  {row.sub && <span className="palette-item-sub">{row.sub}</span>}
                  {cursor === i && <CornerDownLeft size={13} className="palette-enter" />}
                </button>
              </div>
            )
          })}
          {q.trim() && !loading && rows.length === 0 && (
            <div className="palette-empty">没有找到匹配「{q}」的文档</div>
          )}
        </div>

        <div className="palette-footer">
          <span><kbd className="kbd">↑↓</kbd> 选择</span>
          <span><kbd className="kbd">↵</kbd> 打开</span>
          <span><kbd className="kbd">esc</kbd> 关闭</span>
        </div>
      </div>
    </div>
  )
}
