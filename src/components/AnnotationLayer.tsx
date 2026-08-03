'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, MessageSquarePlus, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { useToast } from './Toast'

/* ---------- 类型（与 API 返回一致） ---------- */
interface AnnComment {
  author: string
  body: string
  at: string
}
interface Ann {
  id: string
  author: string
  created_at: string
  resolved: boolean
  comments: AnnComment[]
  status: 'exact' | 'relocated' | 'orphaned'
  located: { start: number; end: number } | null
  anchor: { quote: string; section: string }
}

interface SelInfo {
  quote: string
  x: number
  y: number
  estStart: number
  estEnd: number
  section: string
}

const CHANGED_EVENT = 'gitmd-annotations-changed'

export default function AnnotationLayer({ doc }: { doc: string }) {
  const toast = useToast()
  const [anns, setAnns] = useState<Ann[]>([])
  const [sel, setSel] = useState<SelInfo | null>(null)
  const [composing, setComposing] = useState(false)
  const [body, setBody] = useState('')
  const [openRange, setOpenRange] = useState<{ start: number; end: number; x: number; y: number } | null>(null)
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [me, setMe] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)

  const article = useCallback(() => document.querySelector<HTMLElement>('.doc-article .md-body'), [])

  /* ---------- 数据加载 ---------- */
  const load = useCallback(async () => {
    const res = await fetch('/api/annotations?path=' + encodeURIComponent(doc))
    if (res.ok) {
      const data = await res.json()
      setAnns(data.annotations ?? [])
    }
  }, [doc])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => setMe(u?.git_name ?? ''))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步加载完成后才 setState
    load()
    const onChanged = () => load()
    window.addEventListener(CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(CHANGED_EVENT, onChanged)
  }, [load])

  /* ---------- 高亮（虚线标注）应用与重排 ---------- */
  /** 在 el 的文本节点区间 [from, to) 上逐文本节点套 mark */
  function wrapRange(el: HTMLElement, from: number, to: number, aid: string, s: number, e: number) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let pos = 0
    let node = walker.nextNode()
    while (node) {
      const len = node.textContent?.length ?? 0
      const nStart = pos
      const nEnd = pos + len
      const a = Math.max(0, from - nStart)
      const b = Math.min(len, to - nStart)
      // 跳过空节点与空区间：否则 surroundContents 会不断制造新的空文本节点，walker 永远走不完（死循环）
      if (nEnd > from && nStart < to && a < b && node.parentElement && !node.parentElement.closest('mark.annotation-mark')) {
        const mark = document.createElement('mark')
        mark.className = 'annotation-mark'
        mark.dataset.aid = aid
        mark.dataset.start = String(s)
        mark.dataset.end = String(e)
        const range = document.createRange()
        range.setStart(node, a)
        range.setEnd(node, b)
        try {
          range.surroundContents(mark)
        } catch {
          // 忽略无法包裹的片段
        }
      }
      pos = nEnd
      node = walker.nextNode()
    }
  }

  const applyMarks = useCallback(() => {
    const root = article()
    if (!root) return
    // 先清除旧标记（unwrap）
    root.querySelectorAll('mark.annotation-mark').forEach((m) => {
      const parent = m.parentNode
      while (m.firstChild) parent?.insertBefore(m.firstChild, m)
      parent?.removeChild(m)
    })
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-source-start]'))
    const ds = (el: HTMLElement) => Number(el.dataset.sourceStart)
    const de = (el: HTMLElement) => Number(el.dataset.sourceEnd)

    for (const ann of anns) {
      if (!ann.located) continue
      const { start, end } = ann.located
      // 找包含整个锚点的最深元素
      const block = els.filter((el) => ds(el) <= start && de(el) >= end).pop()
      if (!block) continue
      // 在块文本中定位 quote 精确位置，按文本节点逐段包裹；找不到说明块不匹配，跳过而非乱标
      const idx = block.textContent?.indexOf(ann.anchor.quote) ?? -1
      if (idx < 0) continue
      wrapRange(block, idx, idx + ann.anchor.quote.length, ann.id, start, end)
    }
  }, [anns, article])

  // DOM 变化（流式分块到达）后重排标记。
  // 注意：applyMarks 自身会改写 DOM，必须先断开 observer 再应用，否则会无限自触发
  useEffect(() => {
    const root = article()
    if (!root) return
    const target: HTMLElement = root
    let timer: ReturnType<typeof setTimeout> | undefined
    const mo = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(safeApply, 250)
    })
    function safeApply() {
      mo.disconnect()
      applyMarks()
      mo.observe(target, { childList: true, subtree: true, characterData: true })
    }
    mo.observe(target, { childList: true, subtree: true, characterData: true })
    safeApply()
    return () => {
      mo.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [applyMarks, article, doc])

  /* ---------- 选区 → 新建批注 ---------- */
  useEffect(() => {
    function onMouseUp() {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return
      const range = selection.getRangeAt(0)
      const root = article()
      if (!root || !root.contains(range.commonAncestorContainer)) return
      const quote = selection.toString().trim()
      if (!quote || quote.length > 500) return

      // 已有批注的文字不允许重叠批注
      const asEl = (n: Node): Element | null => (n instanceof Element ? n : n.parentElement)
      const startMark = asEl(range.startContainer)?.closest('mark.annotation-mark')
      const endMark = asEl(range.endContainer)?.closest('mark.annotation-mark')
      if (startMark || endMark) {
        toast.push('info', '该段文字已有批注，点击虚线部分直接查看')
        return
      }

      // 估计源码范围：就近取带 data-source-* 的祖先
      const srcEl = (n: Node | null): HTMLElement | null => {
        let el: HTMLElement | null = n instanceof HTMLElement ? n : n?.parentElement ?? null
        while (el && el.dataset.sourceStart === undefined) el = el.parentElement
        return el
      }
      const sEl = srcEl(range.startContainer)
      const eEl = srcEl(range.endContainer)
      if (!sEl || !eEl) return

      // 所在最近标题
      const headings = Array.from(root.querySelectorAll<HTMLElement>('h2[data-source-start], h3[data-source-start]'))
      const before = headings.filter((h) => Number(h.dataset.sourceStart) <= Number(sEl.dataset.sourceStart))
      const section = before.length ? (before[before.length - 1].textContent ?? '') : ''

      const rect = range.getBoundingClientRect()
      setSel({
        quote,
        x: Math.min(rect.left, window.innerWidth - 340),
        y: rect.bottom + 8,
        estStart: Number(sEl.dataset.sourceStart),
        estEnd: Number(eEl.dataset.sourceEnd),
        section,
      })
      setComposing(false)
      setBody('')
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [article, toast])

  /* ---------- 点击虚线标记 → 批注气泡 ---------- */
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const mark = (e.target as HTMLElement).closest?.('mark.annotation-mark') as HTMLElement | null
      if (mark) {
        const rect = mark.getBoundingClientRect()
        setOpenRange({
          start: Number(mark.dataset.start),
          end: Number(mark.dataset.end),
          x: Math.min(rect.left, window.innerWidth - 380),
          y: rect.bottom + 8,
        })
        setSel(null)
      } else if (!(e.target as HTMLElement).closest?.('.annotation-popover')) {
        setOpenRange(null)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  /* ---------- 提交 ---------- */
  async function submitNew() {
    if (!sel || !body.trim() || submitting) return
    setSubmitting(true)
    const res = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: doc,
        quote: sel.quote,
        estStart: sel.estStart,
        estEnd: sel.estEnd,
        section: sel.section,
        body: body.trim(),
      }),
    })
    const data = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (res.ok) {
      toast.push('success', '批注已提交')
      setSel(null)
      setBody('')
      window.getSelection()?.removeAllRanges()
      window.dispatchEvent(new Event(CHANGED_EVENT))
    } else {
      toast.push('error', data.error ?? '批注失败')
    }
  }

  async function action(id: string, act: 'reply' | 'resolve' | 'delete', text?: string) {
    const res = await fetch('/api/annotations/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: doc, id, action: act, body: text }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      window.dispatchEvent(new Event(CHANGED_EVENT))
      if (act === 'delete') setOpenRange(null)
    } else {
      toast.push('error', data.error ?? '操作失败')
    }
  }

  // 同一段文字的所有批注：按时间正序，最新在底部
  const openAnns = openRange
    ? anns
        .filter((a) => a.located && a.located.start <= openRange.end && a.located.end >= openRange.start)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    : []

  return (
    <div ref={rootRef}>
      {/* 选区弹出的"添加批注" */}
      {sel && !composing && (
        <button
          className="annotation-hint"
          style={{ left: sel.x, top: sel.y }}
          onClick={() => setComposing(true)}
        >
          <MessageSquarePlus size={14} />
          批注
        </button>
      )}

      {/* 新建批注输入框 */}
      {sel && composing && (
        <div className="annotation-popover" style={{ left: sel.x, top: sel.y }}>
          <div className="annotation-quote">“{sel.quote.length > 60 ? sel.quote.slice(0, 60) + '…' : sel.quote}”</div>
          <textarea
            autoFocus
            className="annotation-input"
            rows={3}
            placeholder="写下你的批注…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submitNew()
              if (e.key === 'Escape') setSel(null)
            }}
          />
          <div className="annotation-actions">
            <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>
              取消
            </button>
            <button className="btn btn-sm btn-primary" onClick={submitNew} disabled={!body.trim() || submitting}>
              <Send size={12} />
              提交
            </button>
          </div>
        </div>
      )}

      {/* 批注查看气泡（同一段文字可有多条） */}
      {openRange && openAnns.length > 0 && (
        <div className="annotation-popover annotation-thread" style={{ left: openRange.x, top: openRange.y }}>
          <div className="annotation-popover-head">
            <span>{openAnns.length} 条批注</span>
            <button className="btn btn-icon" style={{ width: 22, height: 22 }} aria-label="关闭" onClick={() => setOpenRange(null)}>
              <X size={13} />
            </button>
          </div>
          {openAnns.map((a) => (
            <div key={a.id} className={`annotation-card ${a.resolved ? 'resolved' : ''}`}>
              <div className="annotation-card-head">
                <span className="annotation-author">{a.author}</span>
                <span className="annotation-time">{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                {a.status === 'relocated' && <span className="ann-badge">已移动</span>}
                {a.status === 'orphaned' && <span className="ann-badge warn">原文已变更</span>}
                {a.resolved && <span className="ann-badge ok">已解决</span>}
              </div>
              {a.status === 'orphaned' && <div className="annotation-quote">原文：“{a.anchor.quote}”</div>}
              {a.comments.map((c, i) => (
                <div key={i} className="annotation-comment">
                  <span className="annotation-comment-author">{c.author}</span>
                  <span className="annotation-comment-body">{c.body}</span>
                </div>
              ))}
              <div className="annotation-reply-row">
                <input
                  className="input annotation-reply-input"
                  placeholder="回复…"
                  value={replyDraft[a.id] ?? ''}
                  onChange={(e) => setReplyDraft({ ...replyDraft, [a.id]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (replyDraft[a.id] ?? '').trim()) {
                      action(a.id, 'reply', replyDraft[a.id])
                      setReplyDraft({ ...replyDraft, [a.id]: '' })
                    }
                  }}
                />
                <button
                  className="btn btn-icon"
                  aria-label={a.resolved ? '重新打开' : '标记已解决'}
                  title={a.resolved ? '重新打开' : '标记已解决'}
                  onClick={() => action(a.id, 'resolve')}
                >
                  {a.resolved ? <RotateCcw size={14} /> : <Check size={14} />}
                </button>
                {a.author === me && (
                  <button
                    className="btn btn-icon btn-danger"
                    aria-label="删除批注"
                    title="删除批注"
                    onClick={() => action(a.id, 'delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
