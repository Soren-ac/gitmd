import fs from 'node:fs'
import path from 'node:path'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { parse as parseYaml } from 'yaml'
import { Clock, FileText, Folder, GitCommitHorizontal, History, Pencil, Tag } from 'lucide-react'
import { config } from '@/lib/core/config'
import { fileLog, isRepoCloned, withGitLock } from '@/lib/git/git'
import { readDoc, buildTree, type TreeNode } from '@/lib/content/docs'
import {
  createRenderState,
  getRenderPlan,
  renderMarkdownChunk,
  type RenderState,
} from '@/lib/markdown/markdown'
import RightToc from '@/components/docs/RightToc'
import DocTracker from '@/components/layout/DocTracker'
import AnnotationLayer from '@/components/annotations/AnnotationLayer'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug?: string[] }>
}

/** slug → 仓库内 md 文件绝对路径：目录时找 README/index，无扩展名时补 .md */
function resolveDoc(slug: string[]): { abs: string; rel: string; isDirListing: boolean } | null {
  const rel = slug.map(decodeURIComponent).join('/')
  const abs = path.normalize(path.join(config.repoDir, rel))
  if (abs !== config.repoDir && !abs.startsWith(config.repoDir + path.sep)) return null

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    for (const name of ['README.md', 'index.md', 'readme.md']) {
      const candidate = path.join(abs, name)
      if (fs.existsSync(candidate)) {
        return { abs: candidate, rel: path.join(rel, name), isDirListing: false }
      }
    }
    return { abs, rel, isDirListing: true }
  }
  const withExt = /\.mdx?$/i.test(abs) ? abs : `${abs}.md`
  if (fs.existsSync(withExt)) {
    return { abs: withExt, rel: /\.mdx?$/i.test(rel) ? rel : `${rel}.md`, isDirListing: false }
  }
  return null
}

function parseFm(raw: string): { description?: string; tags: string[] } {
  if (!raw.trim()) return { tags: [] }
  try {
    const data = parseYaml(raw) as Record<string, unknown>
    const tags = Array.isArray(data?.tags)
      ? data.tags.map(String)
      : typeof data?.tags === 'string'
        ? data.tags.split(',').map((s: string) => s.trim())
        : []
    return { description: typeof data?.description === 'string' ? data.description : undefined, tags }
  } catch {
    return { tags: [] }
  }
}

function readingMinutes(text: string): number {
  return Math.max(1, Math.round(text.length / 450))
}

function DirListing({ rel, tree }: { rel: string; tree: TreeNode[] }) {
  function find(nodes: TreeNode[], p: string): TreeNode[] {
    if (!p) return nodes
    for (const n of nodes) {
      if (n.path === p && n.children) return n.children
      if (n.children) {
        const r = find(n.children, p)
        if (r.length) return r
      }
    }
    return []
  }
  const items = rel ? find(tree, rel) : tree
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <Folder size={26} />
        <div className="empty-title">此目录下暂无文档</div>
      </div>
    )
  }
  return (
    <div className="card">
      {items.map((n) => (
        <Link
          key={n.path}
          href={n.type === 'dir' ? '/docs/' + n.path : '/docs/' + n.path.replace(/\.mdx?$/i, '')}
          className="dir-row"
        >
          {n.type === 'dir' ? <Folder size={15} /> : <FileText size={15} />}
          {n.type === 'dir' ? n.name : n.name.replace(/\.mdx?$/i, '')}
        </Link>
      ))}
    </div>
  )
}

function Breadcrumb({ rel }: { rel: string }) {
  const parts = rel.replace(/\.mdx?$/i, '').split('/')
  return (
    <nav className="breadcrumb" aria-label="文档路径">
      {parts.map((p, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {i > 0 && <span className="crumb-sep">/</span>}
          <span className={`crumb ${i === parts.length - 1 ? 'crumb-current' : ''}`}>{p}</span>
        </span>
      ))}
    </nav>
  )
}

/** 延迟块：按块顺序渲染（共享 slug 状态），流式送达；offsets 用于校正批注锚点属性 */
async function DeferredChunks({
  chunks,
  offsets,
  docDir,
  state,
}: {
  chunks: string[]
  offsets: number[]
  docDir: string
  state: RenderState
}) {
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < chunks.length; i++) {
    nodes.push(await renderMarkdownChunk(chunks[i], docDir, state, { baseOffset: offsets[i] }))
  }
  return <>{nodes}</>
}

function DeferredSkeleton() {
  return (
    <div className="deferred-skeleton" aria-hidden>
      <div className="skeleton" style={{ height: 26, width: '42%' }} />
      <div className="skeleton" style={{ height: 14, width: '96%' }} />
      <div className="skeleton" style={{ height: 14, width: '88%' }} />
      <div className="skeleton" style={{ height: 120, width: '100%' }} />
      <div className="skeleton" style={{ height: 14, width: '70%' }} />
    </div>
  )
}

export default async function DocsPage({ params }: Props) {
  const { slug = [] } = await params

  if (!isRepoCloned()) {
    return (
      <div className="doc-container">
        <div className="empty-state" style={{ paddingTop: 120 }}>
          <div className="spinner" />
          <div className="empty-title">仓库尚未就绪</div>
          <div className="empty-desc">
            仓库正在克隆或同步失败，请稍后刷新。管理员可到{' '}
            <Link href="/admin" style={{ color: 'var(--accent)' }}>
              管理页
            </Link>{' '}
            查看同步状态。
          </div>
        </div>
      </div>
    )
  }

  const resolved = resolveDoc(slug)
  const tree = buildTree()

  if (!resolved) {
    if (slug.length === 0) {
      return (
        <div className="doc-container">
          <div className="page-head">
            <h1>全部文档</h1>
          </div>
          <DirListing rel="" tree={tree} />
        </div>
      )
    }
    notFound()
  }

  if (resolved.isDirListing) {
    return (
      <div className="doc-container">
        <div className="page-head">
          <h1>{path.basename(resolved.rel) || '全部文档'}</h1>
        </div>
        <DirListing rel={resolved.rel} tree={tree} />
      </div>
    )
  }

  const doc = readDoc(resolved.abs)
  const fm = parseFm(doc.frontmatter)
  const docDir = path.posix.dirname(resolved.rel) === '.' ? '' : path.posix.dirname(resolved.rel)
  const { chunks, toc } = getRenderPlan(doc.body)
  const renderState = createRenderState()
  // 各块在全文中的起始偏移（批注锚点 data-source-* 以此为基准）
  const offsets: number[] = []
  {
    let acc = 0
    for (const c of chunks) {
      offsets.push(acc)
      acc += c.length
    }
  }
  const firstChunk = await renderMarkdownChunk(chunks[0], docDir, renderState, {
    stripFirstH1: true,
    baseOffset: 0,
  })
  const relNoExt = resolved.rel.replace(/\.mdx?$/i, '')
  const lastCommit = (await withGitLock(() => fileLog(resolved.rel, 1)))[0]

  return (
    <div className="doc-layout">
      <DocTracker path={resolved.rel} title={doc.title} />
      <div className="doc-article">
        <header className="doc-header">
          <Breadcrumb rel={resolved.rel} />
          <h1 className="doc-title">{doc.title}</h1>
          {fm.description && <p className="doc-desc">{fm.description}</p>}
          <div className="doc-meta">
            <span className="doc-meta-item">
              <Clock size={13} />
              约 {readingMinutes(doc.body)} 分钟
            </span>
            {lastCommit && (
              <span className="doc-meta-item" title={lastCommit.message}>
                <GitCommitHorizontal size={13} />
                {lastCommit.author} 更新于 {new Date(lastCommit.date).toLocaleDateString('zh-CN')}
              </span>
            )}
            {fm.tags.map((t) => (
              <span key={t} className="doc-tag">
                <Tag size={11} />
                {t}
              </span>
            ))}
            <span className="spacer" />
            <Link className="btn btn-sm" href={'/edit/' + relNoExt.split('/').map(encodeURIComponent).join('/')}>
              <Pencil size={13} />
              编辑
            </Link>
            <Link
              className="btn btn-sm btn-ghost"
              href={'/history/' + relNoExt.split('/').map(encodeURIComponent).join('/')}
            >
              <History size={13} />
              历史
            </Link>
          </div>
        </header>
        <article className="md-body">
          {firstChunk}
          {chunks.length > 1 && (
            <Suspense fallback={<DeferredSkeleton />}>
              <DeferredChunks chunks={chunks.slice(1)} offsets={offsets.slice(1)} docDir={docDir} state={renderState} />
            </Suspense>
          )}
        </article>
        <AnnotationLayer doc={resolved.rel} />
      </div>

      <aside className="right-rail">
        <RightToc toc={toc} />
        {lastCommit && (
          <div className="rail-section">
            <div className="rail-title">最近提交</div>
            <div className="rail-commit">
              <code className="commit-hash">{lastCommit.abbrev}</code>
              <span className="rail-commit-msg" title={lastCommit.message}>
                {lastCommit.message}
              </span>
            </div>
            <div className="rail-meta">
              {lastCommit.author} · {new Date(lastCommit.date).toLocaleString('zh-CN')}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
