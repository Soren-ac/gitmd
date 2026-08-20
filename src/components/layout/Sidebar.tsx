'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
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
  /** 是否展示写操作入口（新建/重命名/删除/拖拽移动），匿名用户为 false */
  canEdit: boolean
  open: boolean
  onClose: () => void
}

function docHref(path: string) {
  return '/docs/' + path.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

function editHrefOf(p: string) {
  return '/edit/' + p.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
}

function dirOf(p: string) {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/** 展平目录树 → 缩进列表（「移动到目录」选择器用） */
function collectDirs(nodes: TreeNode[], depth = 0, out: { path: string; name: string; depth: number }[] = []) {
  for (const n of nodes) {
    if (n.type === 'dir') {
      out.push({ path: n.path, name: n.name, depth })
      collectDirs(n.children ?? [], depth + 1, out)
    }
  }
  return out
}

const DRAG_TYPE = 'application/x-gitmd-doc'

interface WriteEvent {
  stage?: 'committed' | 'pushed' | 'done' | 'error'
  ok?: boolean
  path?: string
  error?: string
}

/** 消费写操作的 NDJSON 事件流：onCommitted 在本地提交完成时触发（推送 GitHub 仍在后台进行，
 *  UI 据此立即反应不等网络往返）；error 事件（多为推送冲突后工作区被回滚）抛异常 */
async function consumeWriteStream(res: Response, onCommitted: (ev: WriteEvent) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const ev = JSON.parse(line) as WriteEvent
      if (ev.stage === 'committed') onCommitted(ev)
      else if (ev.stage === 'error') throw new Error(ev.error ?? '操作失败')
    }
  }
}

interface Ctx {
  collapseTick: number
  canEdit: boolean
  dropTarget: string | null
  onNavigate: () => void
  onNewDoc: (dir: string) => void
  onRename: (node: TreeNode) => void
  onDelete: (node: TreeNode) => void
  onDragStartDoc: (e: React.DragEvent, node: TreeNode) => void
  onDragOverDir: (e: React.DragEvent, node: TreeNode) => void
  onDragOverFile: (e: React.DragEvent) => void
  onDropToDir: (e: React.DragEvent, node: TreeNode) => void
  onContextMenuDoc: (e: React.MouseEvent, node: TreeNode) => void
}

function TreeItem({ node, depth, ctx }: { node: TreeNode; depth: number; ctx: Ctx }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(depth < 2)

  // 折叠全部：渲染期比较 tick，避免 effect 级联
  const [prevTick, setPrevTick] = useState(ctx.collapseTick)
  if (prevTick !== ctx.collapseTick) {
    setPrevTick(ctx.collapseTick)
    setOpen(false)
  }

  if (node.type === 'dir') {
    return (
      <div>
        <div
          className={`tree-item ${ctx.dropTarget === node.path ? 'drop-target' : ''}`}
          onClick={() => setOpen(!open)}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onKeyDown={(e) => e.key === 'Enter' && setOpen(!open)}
          onDragOver={(e) => ctx.onDragOverDir(e, node)}
          onDrop={(e) => ctx.onDropToDir(e, node)}
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
    <div
      className={`tree-item file ${pathname === href ? 'active' : ''}`}
      draggable={ctx.canEdit}
      onDragStart={(e) => ctx.onDragStartDoc(e, node)}
      onDragOver={ctx.onDragOverFile}
      onContextMenu={(e) => {
        if (!ctx.canEdit) return
        e.preventDefault()
        ctx.onContextMenuDoc(e, node)
      }}
      title={ctx.canEdit ? `${node.path}（可拖拽到目录，或右键更多操作）` : node.path}
    >
      <span className="tree-spacer" />
      {/* Link 默认 draggable 会抢走上层 div 的自定义拖拽，禁掉 */}
      <Link href={href} className="tree-label" draggable={false} onClick={ctx.onNavigate}>
        <FileText size={14} className="tree-icon" />
        {label}
      </Link>
      {ctx.canEdit && (
        <span className="ops">
          <button className="btn-icon btn" aria-label={`重命名 ${node.name}`} title={`重命名 ${node.name}`} onClick={() => ctx.onRename(node)}>
            <Pencil size={13} />
          </button>
          <button className="btn-icon btn btn-danger" aria-label={`删除 ${node.name}`} onClick={() => ctx.onDelete(node)}>
            <Trash2 size={13} />
          </button>
        </span>
      )}
    </div>
  )
}

interface CtxMenuState {
  x: number
  y: number
  node: TreeNode
  mode: 'main' | 'dirs'
}

export default function Sidebar({ tree, repoReady, canEdit, open, onClose }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const dialog = useDialog()
  const [filter, setFilter] = useState('')
  const [collapseTick, setCollapseTick] = useState(0)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<CtxMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const asideRef = useRef<HTMLElement>(null)

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

  const dirs = useMemo(() => collectDirs(tree), [tree])

  // 右键菜单：点外部 / Escape 关闭
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // 拖拽结束（无论落点）清理高亮；拖出侧边栏也清理
  useEffect(() => {
    const onDragEnd = () => setDropTarget(null)
    document.addEventListener('dragend', onDragEnd)
    return () => document.removeEventListener('dragend', onDragEnd)
  }, [])

  /** 统一移动入口：改名（toDir 不变 + newName）与换目录（newName 为空）都走这里 */
  async function moveDoc(from: string, toDir: string, newName?: string) {
    const name = newName ?? from.slice(from.lastIndexOf('/') + 1)
    const to = toDir ? `${toDir}/${name}` : name
    if (to === from) return
    const res = await fetch('/api/docs/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.identityRequired) {
        router.push('/settings')
        return
      }
      toast.push('error', d.error ?? '移动失败')
      return
    }
    // 正查看/编辑被移动文档时需要跟随跳转：整页跳转避开陈旧的 Router Cache
    const viewing = pathname === docHref(from) || pathname === editHrefOf(from)
    try {
      await consumeWriteStream(res, () => {
        // 本地提交完成（推送在后台继续）：立即反应，不等 GitHub 网络往返
        if (viewing) {
          window.location.assign(pathname.startsWith('/edit/') ? editHrefOf(to) : docHref(to))
          return
        }
        toast.push('success', `已移动到 ${to}`)
        router.refresh()
      })
    } catch (err) {
      // 推送冲突等：工作区可能已被回滚，刷新对齐服务端状态
      toast.push('error', err instanceof Error ? err.message : '移动失败')
      if (!viewing) router.refresh()
    }
  }

  /** 重命名：输入框只给文档名（不含目录前缀与扩展名），目录保持不变 */
  async function renameDoc(node: TreeNode) {
    const dir = dirOf(node.path)
    const ext = node.path.match(/\.mdx?$/i)?.[0] ?? '.md'
    const cur = node.name.replace(/\.mdx?$/i, '')
    const name = await dialog.prompt({
      title: '重命名文档',
      message: `仅修改文档名，目录保持不变（${dir || '根目录'}）。换目录可在树中拖拽，或右键「移动到目录」。`,
      input: { placeholder: '文档名', defaultValue: cur },
    })
    if (!name || name === cur) return
    if (/[\\/]/.test(name)) {
      toast.push('error', '文档名不能包含 / 或 \\')
      return
    }
    if (name === '.' || name === '..') {
      toast.push('error', '文档名不合法')
      return
    }
    await moveDoc(node.path, dir, name + ext)
  }

  async function deleteDoc(node: TreeNode) {
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
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      if (d.identityRequired) {
        router.push('/settings')
        return
      }
      toast.push('error', d.error ?? '删除失败')
      return
    }
    // 正查看/编辑被删文档时跳回目录：同 moveDoc，整页跳转避开陈旧的 Router Cache
    const viewing = pathname === docHref(node.path) || pathname === editHrefOf(node.path)
    try {
      await consumeWriteStream(res, () => {
        if (viewing) {
          window.location.assign('/docs')
          return
        }
        toast.push('success', `已删除 ${node.path}`)
        router.refresh()
      })
    } catch (err) {
      toast.push('error', err instanceof Error ? err.message : '删除失败')
      if (!viewing) router.refresh()
    }
  }

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

  // ------- 拖拽移动 -------
  function hasDocPayload(e: React.DragEvent) {
    return e.dataTransfer.types.includes(DRAG_TYPE)
  }

  function dropTo(e: React.DragEvent, toDir: string) {
    if (!hasDocPayload(e)) return
    e.preventDefault()
    setDropTarget(null)
    const from = e.dataTransfer.getData(DRAG_TYPE)
    // 拖回原目录 = 无操作
    if (from && dirOf(from) !== toDir) void moveDoc(from, toDir)
  }

  const ctx: Ctx = {
    collapseTick,
    canEdit,
    dropTarget,
    onNavigate: onClose,
    onNewDoc: (dir) => void newDoc(dir),
    onRename: (node) => void renameDoc(node),
    onDelete: (node) => void deleteDoc(node),
    onDragStartDoc: (e, node) => {
      e.dataTransfer.setData(DRAG_TYPE, node.path)
      e.dataTransfer.setData('text/plain', node.path)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOverDir: (e, node) => {
      if (!canEdit || !hasDocPayload(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      setDropTarget(node.path)
    },
    // 文件行不是放置目标：不 preventDefault，仅阻断冒泡并清掉高亮
    onDragOverFile: (e) => {
      e.stopPropagation()
      setDropTarget(null)
    },
    onDropToDir: (e, node) => {
      e.stopPropagation()
      dropTo(e, node.path)
    },
    onContextMenuDoc: (e, node) => {
      const x = Math.min(e.clientX, window.innerWidth - 200)
      const y = Math.min(e.clientY, window.innerHeight - 220)
      setMenu({ x, y, node, mode: 'main' })
    },
  }

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'show' : ''}`} onClick={onClose} />
      <aside
        ref={asideRef}
        className={`sidebar ${open ? 'open' : ''}`}
        onDragLeave={(e) => {
          if (!asideRef.current?.contains(e.relatedTarget as Node)) setDropTarget(null)
        }}
      >
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

        <nav
          className={`sidebar-tree ${dropTarget === '' ? 'drop-target-root' : ''}`}
          aria-label="文档目录"
          onDragOver={(e) => {
            if (!canEdit || !hasDocPayload(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropTarget('')
          }}
          onDrop={(e) => dropTo(e, '')}
        >
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

      {/* 文档树右键菜单：重命名 / 移动到目录 / 删除 */}
      {menu && (
        <div ref={menuRef} className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
          {menu.mode === 'main' ? (
            <>
              <button
                className="user-menu-item"
                onClick={() => {
                  const n = menu.node
                  setMenu(null)
                  void renameDoc(n)
                }}
              >
                <Pencil size={13} />
                重命名
              </button>
              <button className="user-menu-item" onClick={() => setMenu({ ...menu, mode: 'dirs' })}>
                <FolderInput size={13} />
                移动到目录
              </button>
              <button
                className="user-menu-item ctx-danger"
                onClick={() => {
                  const n = menu.node
                  setMenu(null)
                  void deleteDoc(n)
                }}
              >
                <Trash2 size={13} />
                删除
              </button>
            </>
          ) : (
            <>
              <div className="user-menu-head">
                <button
                  className="btn btn-icon"
                  style={{ width: 20, height: 20 }}
                  aria-label="返回"
                  onClick={() => setMenu({ ...menu, mode: 'main' })}
                >
                  <ChevronLeft size={13} />
                </button>
                移动到…
              </div>
              <div className="ctx-menu-list">
                <button
                  className="user-menu-item"
                  onClick={() => {
                    setMenu(null)
                    void moveDoc(menu.node.path, '')
                  }}
                >
                  <FolderOpen size={13} />
                  根目录
                </button>
                {dirs.map((d) => (
                  <button
                    key={d.path}
                    className="user-menu-item"
                    style={{ paddingLeft: 10 + d.depth * 14 }}
                    title={d.path}
                    onClick={() => {
                      setMenu(null)
                      void moveDoc(menu.node.path, d.path)
                    }}
                  >
                    <Folder size={13} />
                    {d.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
