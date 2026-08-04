import Link from 'next/link'
import { FileText, SearchX } from 'lucide-react'
import { searchDocs } from '@/lib/search/search'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ q?: string }>
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = '' } = await searchParams
  const results = q ? searchDocs(q) : []

  return (
    <div className="doc-container">
      <div className="page-head">
        <h1>搜索</h1>
        {q && (
          <span className="muted">
            “{q}” · {results.length} 条结果
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
    </div>
  )
}
