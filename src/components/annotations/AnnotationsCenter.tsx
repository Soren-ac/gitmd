'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, MessageSquare, MessageSquareWarning } from 'lucide-react'

interface Item {
  id: string
  doc: string
  quote: string
  author: string
  created_at: string
  resolved: boolean
  commentCount: number
  lastComment: { author: string; body: string; at: string } | null
}

type Filter = 'open' | 'resolved' | 'all'

function docHref(doc: string) {
  return '/docs/' + doc.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

function groupByDoc(items: Item[]): Map<string, Item[]> {
  const m = new Map<string, Item[]>()
  for (const a of items) {
    const list = m.get(a.doc) ?? []
    list.push(a)
    m.set(a.doc, list)
  }
  return m
}

export default function AnnotationsCenter() {
  const [filter, setFilter] = useState<Filter>('open')
  const [items, setItems] = useState<Item[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/annotations/all?status=${filter === 'all' ? 'all' : filter}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setItems(d?.annotations ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [filter])

  const openCount = items?.filter((a) => !a.resolved).length ?? 0

  return (
    <div className="doc-container" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <h1>批注中心</h1>
        <span className="spacer" />
        <div className="segmented" role="tablist" aria-label="批注筛选">
          {(
            [
              ['open', '未解决'],
              ['resolved', '已解决'],
              ['all', '全部'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 64, width: `${100 - i * 8}%` }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <MessageSquare size={26} />
          <div className="empty-title">{filter === 'open' ? '没有未解决的批注' : '暂无批注'}</div>
          <div className="empty-desc">在文档正文选中文字即可发起批注</div>
        </div>
      ) : (
        <>
          {filter === 'all' && openCount > 0 && <p className="muted" style={{ margin: '0 0 12px' }}>共 {items.length} 条，其中 {openCount} 条未解决</p>}
          {[...groupByDoc(items).entries()].map(([doc, anns]) => (
            <section key={doc} style={{ marginBottom: 22 }}>
              <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>
                <Link href={docHref(doc)} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {doc.replace(/\.mdx?$/i, '')}
                </Link>
              </h2>
              <div className="card">
                {anns.map((a) => (
                  <Link key={a.id} href={docHref(doc)} className="ann-center-row">
                    <span className={`ann-center-status ${a.resolved ? 'resolved' : 'open'}`}>
                      {a.resolved ? <Check size={12} /> : <MessageSquareWarning size={12} />}
                      {a.resolved ? '已解决' : '未解决'}
                    </span>
                    <span className="ann-center-quote">“{a.quote.length > 50 ? a.quote.slice(0, 50) + '…' : a.quote}”</span>
                    <span className="ann-center-meta">
                      {a.author} · {a.commentCount} 条评论 · {new Date(a.created_at).toLocaleDateString('zh-CN')}
                    </span>
                    {a.lastComment && <span className="ann-center-last">{a.lastComment.author}：{a.lastComment.body}</span>}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
