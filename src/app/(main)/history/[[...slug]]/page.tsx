import path from 'node:path'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { config } from '@/lib/core/config'
import { isRepoCloned, fileLog, withGitLock } from '@/lib/git/git'
import HistoryList from '@/components/docs/HistoryList'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug?: string[] }>
}

export default async function HistoryPage({ params }: Props) {
  const { slug = [] } = await params
  if (slug.length === 0) notFound()
  const rel = slug.map(decodeURIComponent).join('/')
  const relMd = /\.mdx?$/i.test(rel) ? rel : `${rel}.md`
  const abs = path.normalize(path.join(config.repoDir, relMd))
  if (!abs.startsWith(config.repoDir + path.sep)) notFound()
  if (!isRepoCloned()) return <div className="doc-container">仓库尚未就绪。</div>

  const entries = await withGitLock(() => fileLog(relMd))
  const docHref = '/docs/' + rel.split('/').map(encodeURIComponent).join('/')

  return (
    <div className="doc-container">
      <div className="page-head">
        <Link className="btn btn-ghost btn-sm" href={docHref}>
          ← 返回文档
        </Link>
        <h1>版本历史</h1>
        <span className="muted mono" style={{ fontSize: 12 }}>{relMd}</span>
      </div>
      {entries.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <div className="empty-title">暂无提交历史</div>
        </div>
      )}
      <HistoryList entries={entries} path={relMd} />
    </div>
  )
}
