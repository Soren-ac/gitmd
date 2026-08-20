'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  ListTree,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import type { TreeNode } from '@/lib/content/docs'
import { useToast } from '@/components/common/Toast'
import { useDialog } from '@/components/common/Dialog'

interface Props {
  tree: TreeNode[]
  repoReady: boolean
  /** 是否展示写操作入口（新建/重命名/删除），匿名用户为 false */
  canEdit: boolean
  open: boolean
  onClose: () => void
}

function docHref(path: string) {
  return '/docs/' + path.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

interface Ctx {
  collapseTick: number
  canEdit: boolean
  onNavigate: () => void
  onNewDoc: (dir: string) => void
}

function TreeItem({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: Ctx }) {
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()
  const dialog = useDialog()
  const [open, setOpen] = useState(depth < 2)

  // 折叠全部：渲染期比较 tick，避免 effect 级联
  const [prevTick, setPrevTick] = useState(ctx.collapseTick)
  if (prevTick !== ctx.collapseTick) {
    setPrevTick(ctx.collapseTick)
    setOpen(false)
  }

  async function op(action: 'rename' | 'delete') {
    const editHrefOf = (p: string) =>
      '/edit/' + p.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
    /** 正在查看/编辑该文档（删除/移动后当前页会变 404，需要跟随跳转） */
    const onThisDoc = (p: string) => pathname === docHref(p) || pathname === editHrefOf(p)

    if (action === 'rename') {
      const to = await dialog.prompt({
        title: '重命名 / 移动',
        message: `当前路径：${node.path}`,
        input: { placeholder: '新路径（相对仓库根，含 .md）', defaultValue: node.path },
      })
      if (!to || to === node.path) return
      const res = await fetch('/api/docs/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: node.path, to }),
      })
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.push('success', `已移动到 ${to}`)
        // 跟随跳转到新路径后直接返回：旧路由已失效，refresh 会重渲染出 404
        if (typeof data.path === 'string' && onThisDoc(node.path)) {
          router.push(pathname.startsWith('/edit/') ? editHrefOf(data.path) : docHref(data.path))
          return
        }
      } else {
        const d = await res.json().catch(() => ({}))
        if (d.identityRequired) {
          router.push('/settings')
          return
        }
        toast.push('error', d.error ?? '移动失败')
      }
    } else {
      const ok = await dialog.confirm({
        title: '删除文档',
        message: `确定删除 ${node.path}？该操作会立即提交到远端仓库，删除后只能通过 git 历史找回。`,
        confirmText: '删除',
        danger: true,
      })
      if (!ok) return
      const res = await fetch(`/api/docs/${node.path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.push('success', `已删除 ${node.path}`)
        // 正查看/编辑被删文档时跳回目录；同上，跳转后不再 refresh 旧路由
        if (onThisDoc(node.path)) {
          router.push('/docs')
          return
        }
      } else {
        const d = await res.json().catch(() => ({}))
        if (d.identityRequired) {
          router.push('/settings')
          return
        }
        toast.push('error', d.error ?? '删除失败')
      }
    }
    router.refresh()
  }

  if (node.type === 'dir') {
    return (
      <div>
        <div
          className="tree-item"
          onClick={() => setOpen(!open)}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}
        >
          <span className={`tree-chevron ${open ? 'open' : ''}`}>
            <ChevronRight size={13} />
          </span>
          <span className="tree-label">
            <Folder size={14} className="tree-icon" />
            {node.name}
          </span>
          {ctx.canEdit && (
            <span className="ops">
              <button
                className="btn-icon btn"
                aria-label={`在 ${node.name} 下新建文档`}
                title={`在 ${node.name}/ 下新建文档`}
                onClick={(e) => {
                  e.stopPropagation()
                  ctx.onNewDoc(node.path)
                }}
              >
                <FilePlus2 size={13} />
              </button>
            </span>
          )}
        </div>
        <div className={`tree-collapse ${open ? 'open' : ''}`}>
          <div className="tree-children">
            {node.children?.map((c) => (
              <TreeItem key={c.path} node={c} depth={depth + 1} ctx={ctx} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const href = docHref(node.path)
  const label = node.name.replace(/\.mdx?$/i, '')
  return (
    <div className={`tree-item file ${pathname === href ? 'active' : ''}`}>
      <span className="tree-spacer" />
      <Link href={href} title={node.path} className="tree-label" onClick={ctx.onNavigate}>
        <FileText size={14} className="tree-icon" />
        {label}
      </Link>
      {ctx.canEdit && (
        <span className="ops">
          <button className="btn-icon btn" aria-label={`重命名或移动 ${node.name}`} onClick={() => op('rename')}>
            <Pencil size={13} />
          </button>
          <button className="btn-icon btn btn-danger" aria-label={`删除 ${node.name}`} onClick={() => op('delete')}>
            <Trash2 size={13} />
          </button>
        </span>
      )}
    </div>
  )
}

export default function Sidebar({ tree, repoReady, canEdit, open, onClose }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const dialog = useDialog()
  const [filter, setFilter] = useState('')
  const [collapseTick, setCollapseTick] = useState(0)

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return null
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.type === 'file' && n.path.toLowerCase().includes(f)) out.push(n)
        if (n.children) walk(n.children)
      }
    }
    walk(tree)
    return out
  }, [filter, tree])

  async function newDoc(dirPrefix = '') {
    const p = await dialog.prompt(
      dirPrefix
        ? {
            title: `在 ${dirPrefix}/ 下新建文档`,
            message: '只需输入文件名，会自动补 .md 扩展名；支持子路径如 sub/note。',
            input: { placeholder: '文件名', defaultValue: '' },
          }
        : {
            title: '新建文档',
            message: '输入相对仓库根的路径，会自动补 .md 扩展名。',
            input: { placeholder: 'guide/intro.md', defaultValue: newDocBase() },
          },
    )
    if (!p) return
    const name = p.replace(/^\/+/, '')
    if (!name || name.split('/').some((s) => !s || s === '.' || s === '..')) {
      toast.push('error', '文件名不合法')
      return
    }
    const rel = dirPrefix ? `${dirPrefix}/${name}` : name
    const full = /\.mdx?$/i.test(rel) ? rel : `${rel}.md`
    onClose()
    router.push('/edit/' + full.split('/').map(encodeURIComponent).join('/') + '?new=1')
  }

  /** 根级「新建文档」的默认路径前缀：取当前打开文档所在目录 */
  function newDocBase(): string {
    if (!pathname.startsWith('/docs/')) return ''
    const parts = pathname.slice(6).split('/').map(decodeURIComponent)
    parts.pop()
    return parts.length ? parts.join('/') + '/' : ''
  }

  async function newDir() {
    const dir = await dialog.prompt({
      title: '新建目录',
      message: '输入相对仓库根的目录路径，会在其中创建 README.md。',
      input: { placeholder: 'guide/advanced' },
    })
    if (!dir) return
    const name = dir.split('/').pop() ?? dir
    const res = await fetch(`/api/docs/${dir}/README.md`.split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `# ${name}\n`, baseHash: '' }),
    })
    if (res.ok) {
      toast.push('success', `目录 ${dir} 已创建`)
      router.refresh()
    } else {
      const d = await res.json().catch(() => ({}))
      if (d.identityRequired) {
        router.push('/settings')
        return
      }
      toast.push('error', d.error ?? '创建失败')
    }
  }

  const ctx: Ctx = { collapseTick, canEdit, onNavigate: onClose, onNewDoc: (dir) => void newDoc(dir) }

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-header">
          <form
            className="search-box"
            onSubmit={(e) => {
              e.preventDefault()
              if (filter.trim()) {
                onClose()
                router.push('/search?q=' + encodeURIComponent(filter.trim()))
              }
            }}
          >
            <Search size={14} />
            <input
              className="input"
              placeholder="筛选文档…"
              aria-label="筛选文档"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </form>
          <div className="sidebar-actions">
            {canEdit && (
              <>
                <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => void newDoc()}>
                  <FilePlus2 size={13} />
                  新建文档
                </button>
                <button className="btn btn-icon" onClick={newDir} aria-label="新建目录" title="新建目录">
                  <FolderPlus size={15} />
                </button>
              </>
            )}
            <button
              className="btn btn-icon"
              onClick={() => setCollapseTick((t) => t + 1)}
              aria-label="折叠全部目录"
              title="折叠全部"
            >
              <ListTree size={15} />
            </button>
          </div>
        </div>

        <nav className="sidebar-tree" aria-label="文档目录">
          {!repoReady && (
            <div className="empty-state">
              <div className="spinner" />
              <div className="empty-title">正在克隆仓库</div>
              <div className="empty-desc">首次启动需要拉取远端文档，请稍候</div>
            </div>
          )}
          {repoReady && tree.length === 0 && (
            <div className="empty-state">
              <FileText size={26} />
              <div className="empty-title">还没有文档</div>
              {canEdit && <div className="empty-desc">点击上方「新建文档」创建第一篇</div>}
            </div>
          )}
          {filtered
            ? filtered.map((n) => (
                <div key={n.path} className="tree-item file">
                  <span className="tree-spacer" />
                  <Link href={docHref(n.path)} title={n.path} className="tree-label" onClick={onClose}>
                    <FileText size={14} className="tree-icon" />
                    {n.path.replace(/\.mdx?$/i, '')}
                  </Link>
                </div>
              ))
            : tree.map((n) => <TreeItem key={n.path} node={n} depth={0} ctx={ctx} />)}
        </nav>
      </aside>
    </>
  )
}
