import Link from 'next/link'
import { Activity, FilePlus2, FilePenLine, FileX2, FileSymlink, GitCommitHorizontal } from 'lucide-react'
import { isRepoCloned, recentChanges, type ChangedFile } from '@/lib/git/git'

export const dynamic = 'force-dynamic'

const MAX_ENTRIES = 50

function docHref(p: string) {
  return '/docs/' + p.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

function historyHref(p: string) {
  return '/history/' + p.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

/** 相对时间：N 分钟/小时/天前，超过 30 天显示日期 */
function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(t).toLocaleDateString('zh-CN')
}

const STATUS_META: Record<string, { label: string; icon: typeof FilePlus2; className: string }> = {
  A: { label: '新增', icon: FilePlus2, className: 'change-file added' },
  M: { label: '修改', icon: FilePenLine, className: 'change-file modified' },
  D: { label: '删除', icon: FileX2, className: 'change-file deleted' },
  R: { label: '重命名', icon: FileSymlink, className: 'change-file renamed' },
}

function FileChip({ f }: { f: ChangedFile }) {
  const meta = STATUS_META[f.status] ?? STATUS_META.M
  const Icon = meta.icon
  // 已删除的文件去历史页，其余去文档页
  const href = f.status === 'D' ? historyHref(f.path) : docHref(f.path)
  return (
    <Link href={href} className={meta.className} title={`${meta.label} · ${f.oldPath ? f.oldPath + ' → ' : ''}${f.path}`}>
      <Icon size={12} />
      {f.path.replace(/\.mdx?$/i, '')}
    </Link>
  )
}

export default async function RecentPage() {
  const entries = isRepoCloned() ? await recentChanges(MAX_ENTRIES) : []

  return (
    <div className="doc-container">
      <div className="page-head">
        <h1>最近变更</h1>
        <span className="muted">全库文档的最新提交动态</span>
      </div>

      {entries.length === 0 && (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <Activity size={28} />
          <div className="empty-title">暂无变更记录</div>
          <div className="empty-desc">仓库同步后，文档的新增、修改、重命名都会出现在这里</div>
        </div>
      )}

      {entries.map((e) => (
        <div key={e.hash} className="change-entry">
          <div className="change-entry-head">
            <GitCommitHorizontal size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
            <span className="change-msg">{e.message}</span>
            <span className="muted mono" style={{ fontSize: 12, flexShrink: 0 }}>
              {e.abbrev}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12.5, margin: '2px 0 8px' }}>
            {e.author} · {relTime(e.date)}
          </div>
          <div className="change-files">
            {e.files.map((f, i) => (
              <FileChip key={i} f={f} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
