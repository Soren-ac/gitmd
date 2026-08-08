import Link from 'next/link'
import { ChevronLeft, ChevronRight, FileText, SearchX } from 'lucide-react'
import { countDocs, searchDocs } from '@/lib/search/search'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 30

interface Props {
  searchParams: Promise<{ q?: string; offset?: string }>
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = '', offset: offsetParam } = await searchParams
  const offset = Math.max(0, Number(offsetParam) || 0)
  const total = q ? countDocs(q) : 0
  const results = q ? searchDocs(q, PAGE_SIZE, offset) : []
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (p: number) => `/search?q=${encodeURIComponent(q)}&offset=${(p - 1) * PAGE_SIZE}`

  return (
    <div className="doc-container">
      <div className="page-head">
        <h1>搜索</h1>
        {q && (
          <span className="muted">
            “{q}” · 共 {total} 条结果
          </span>
        )}
      </div>

      {!q && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <SearchX size={28} />
          <div className="empty-title">输入关键词开始搜索</div>
          <div className="empty-desc">支持中文全文检索，搜索标题与正文内容</div>
        </div>
      )}

      {q && results.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <SearchX size={28} />
          <div className="empty-title">没有找到匹配的文档</div>
          <div className="empty-desc">换个关键词试试，或检查是否有拼写错误</div>
        </div>
      )}

      {results.map((r) => (
        <div
          key={r.path}
          style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}
        >
          <Link
            href={'/docs/' + r.path.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--accent)',
              textDecoration: 'none',
            }}
          >
            <FileText size={14} style={{ color: 'var(--text-tertiary)' }} />
            {r.title || r.path}
          </Link>
          <div className="muted mono" style={{ fontSize: 12, margin: '4px 0 6px' }}>
            {r.path}
          </div>
          <div
            className="md-body"
            style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}
            dangerouslySetInnerHTML={{ __html: r.snippet }}
          />
        </div>
      ))}

      {pageCount > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: '20px 0',
            fontSize: 13.5,
          }}
        >
          {page > 1 ? (
            <Link href={pageHref(page - 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', textDecoration: 'none' }}>
              <ChevronLeft size={14} /> 上一页
            </Link>
          ) : (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.5 }}>
              <ChevronLeft size={14} /> 上一页
            </span>
          )}
          <span className="muted">
            第 {page} / {pageCount} 页
          </span>
          {page < pageCount ? (
            <Link href={pageHref(page + 1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--accent)', textDecoration: 'none' }}>
              下一页 <ChevronRight size={14} />
            </Link>
          ) : (
            <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, opacity: 0.5 }}>
              下一页 <ChevronRight size={14} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}
