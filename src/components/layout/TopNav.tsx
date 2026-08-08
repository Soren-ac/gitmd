'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  Bell,
  Check,
  GitBranch,
  Link2,
  LogOut,
  Menu,
  MessageSquareText,
  Moon,
  PanelLeft,
  Pencil,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserCog,
  XCircle,
} from 'lucide-react'
import CommandPalette from '@/components/layout/CommandPalette'
import { applyTheme } from '@/lib/client/theme'
import { useToast } from '@/components/common/Toast'
import { copyText } from '@/lib/clipboard'

interface Props {
  user: { username: string; role: string }
  onMenuClick: () => void
  onToggleSidebar: () => void
}

interface SyncState {
  repoCloned: boolean
  branch: string
  state: { last_sync_at: string | null; last_status: string | null; last_head: string | null } | null
}

interface MentionItem {
  annotationId: string
  doc: string
  quote: string
  author: string
  body: string
  at: string
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso + 'Z').getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export default function TopNav({ user, onMenuClick, onToggleSidebar }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const toast = useToast()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [sync, setSync] = useState<SyncState | null>(null)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [mentions, setMentions] = useState<{ count: number; items: MentionItem[] } | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const mentionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 主题存在 DOM data 属性上，挂载后同步一次 */
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    /* eslint-enable react-hooks/set-state-in-effect */
    const onTheme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    window.addEventListener('gitmd-theme', onTheme)
    return () => window.removeEventListener('gitmd-theme', onTheme)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let stopped = false
    async function load() {
      const res = await fetch('/api/sync')
      if (res.ok && !stopped) setSync(await res.json())
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  // 未读提及轮询
  useEffect(() => {
    let stopped = false
    async function load() {
      const res = await fetch('/api/annotations/mentions')
      if (res.ok && !stopped) setMentions(await res.json())
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) setMentionOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function toggleTheme() {
    applyTheme(theme === 'dark' ? 'light' : 'dark')
  }

  async function copyLink() {
    const ok = await copyText(window.location.href)
    toast.push(ok ? 'success' : 'error', ok ? '链接已复制到剪贴板' : '复制失败，请手动复制地址栏链接')
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
    router.refresh()
  }

  const editHref =
    pathname.startsWith('/docs/') && pathname.length > 6
      ? '/edit/' + pathname.slice(6)
      : null
  const syncOk = sync?.state?.last_status === 'ok'
  const syncErr = sync?.state?.last_status === 'error'

  return (
    <>
      <header className="topnav">
        <button className="btn btn-icon nav-menu-btn" aria-label="打开导航" onClick={onMenuClick}>
          <Menu size={17} />
        </button>
        <button
          className="btn btn-icon nav-collapse-btn"
          aria-label="折叠/展开侧边栏"
          title="折叠/展开侧边栏"
          onClick={onToggleSidebar}
        >
          <PanelLeft size={16} />
        </button>

        <Link href="/docs" className="logo">
          <span className="logo-mark">
            <GitBranch size={14} />
          </span>
          GitMD
        </Link>

        <span className="nav-divider" />
        <span className="nav-space">
          文档空间
          {sync?.branch && <span className="nav-branch">{sync.branch}</span>}
        </span>

        <button className="nav-search" onClick={() => setPaletteOpen(true)} aria-label="全局搜索">
          <Search size={14} />
          <span>搜索文档…</span>
          <kbd className="kbd">⌘K</kbd>
        </button>

        <div className="nav-actions">
          <span
            className={`sync-pill ${syncOk ? 'ok' : ''} ${syncErr ? 'err' : ''}`}
            title={sync?.state?.last_head ? `HEAD ${sync.state.last_head.slice(0, 10)}` : ''}
          >
            {syncErr ? <XCircle size={12} /> : syncOk ? <Check size={12} /> : <RefreshCw size={12} />}
            {syncErr ? '同步失败' : syncOk ? `已同步 · ${relTime(sync?.state?.last_sync_at)}` : '同步中'}
          </span>

          <Link className="btn btn-sm" href="/chat" title="文档助手">
            <Sparkles size={13} />
            文档助手
          </Link>
          <Link className="btn btn-icon" href="/recent" title="最近变更" aria-label="最近变更">
            <Activity size={15} />
          </Link>
          <Link className="btn btn-icon" href="/annotations" title="批注中心" aria-label="批注中心">
            <MessageSquareText size={15} />
          </Link>
          {editHref && (
            <Link className="btn btn-sm" href={editHref}>
              <Pencil size={13} />
              编辑
            </Link>
          )}

          {/* 批注提及铃铛 */}
          <div className="user-menu-wrap" ref={mentionRef}>
            <button
              className="btn btn-icon mention-btn"
              aria-label="批注提及"
              title="批注提及"
              onClick={() => setMentionOpen((v) => !v)}
            >
              <Bell size={15} />
              {(mentions?.count ?? 0) > 0 && <span className="mention-badge">{mentions!.count}</span>}
            </button>
            {mentionOpen && (
              <div className="user-menu mention-menu">
                <div className="user-menu-head">
                  批注提及
                  {(mentions?.count ?? 0) > 0 && <span className="role-badge">{mentions!.count} 条未读</span>}
                </div>
                {(mentions?.items.length ?? 0) === 0 && (
                  <div className="mention-empty">暂无 @ 你的批注</div>
                )}
                {(mentions?.items ?? []).map((m, i) => (
                  <button
                    key={`${m.annotationId}-${i}`}
                    className="user-menu-item mention-item"
                    onClick={async () => {
                      setMentionOpen(false)
                      setMentions({ count: 0, items: [] })
                      fetch('/api/annotations/mentions', { method: 'POST' }).catch(() => {})
                      router.push('/docs/' + m.doc.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/'))
                    }}
                  >
                    <span className="mention-item-body">
                      <strong>{m.author}</strong> 在「{m.doc.replace(/\.mdx?$/i, '')}」提及你
                      <span className="mention-item-text">{m.body.slice(0, 80)}</span>
                    </span>
                  </button>
                ))}
                {(mentions?.count ?? 0) > 0 && (
                  <Link
                    href="/annotations"
                    className="user-menu-item"
                    onClick={() => {
                      setMentionOpen(false)
                      setMentions({ count: 0, items: [] })
                      fetch('/api/annotations/mentions', { method: 'POST' }).catch(() => {})
                    }}
                  >
                    前往批注中心查看全部
                  </Link>
                )}
              </div>
            )}
          </div>

          <button className="btn btn-icon" onClick={copyLink} aria-label="复制页面链接" title="复制链接">
            <Link2 size={15} />
          </button>
          <button
            className="btn btn-icon"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            title={theme === 'dark' ? '浅色模式' : '深色模式'}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <div className="user-menu-wrap" ref={menuRef}>
            <button
              className="avatar-btn"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="用户菜单"
              aria-expanded={menuOpen}
            >
              {user.username.slice(0, 1).toUpperCase()}
            </button>
            {menuOpen && (
              <div className="user-menu">
                <div className="user-menu-head">
                  {user.username}
                  {user.role === 'admin' && <span className="role-badge">ADMIN</span>}
                </div>
                <Link href="/annotations" className="user-menu-item" onClick={() => setMenuOpen(false)}>
                  <MessageSquareText size={14} />
                  批注中心
                </Link>
                <Link href="/settings" className="user-menu-item" onClick={() => setMenuOpen(false)}>
                  <UserCog size={14} />
                  Git 身份设置
                </Link>
                {user.role === 'admin' && (
                  <Link href="/admin" className="user-menu-item" onClick={() => setMenuOpen(false)}>
                    <Settings size={14} />
                    平台管理
                  </Link>
                )}
                <button className="user-menu-item" onClick={logout}>
                  <LogOut size={14} />
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}
