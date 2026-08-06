'use client'

import { useRef, useState } from 'react'
import TopNav from '@/components/layout/TopNav'
import Sidebar from '@/components/layout/Sidebar'
import type { TreeNode } from '@/lib/content/docs'

interface Props {
  tree: TreeNode[]
  user: { username: string; role: string }
  repoReady: boolean
  children: React.ReactNode
}

const MIN_W = 200
const MAX_W = 480

/** 侧边栏折叠/宽度状态放在 <html> dataset 与内联 CSS 变量上（首绘脚本初始化），
 *  不经过 React state——避免 SSR/水合不一致，拖拽也无需重渲染 */
export default function AppShell({ tree, user, repoReady, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false) // 移动端抽屉
  const dragging = useRef(false)

  function toggleCollapse() {
    const el = document.documentElement
    if (el.dataset.sidebar === 'collapsed') {
      delete el.dataset.sidebar
      localStorage.setItem('gitmd-sidebar', '')
    } else {
      el.dataset.sidebar = 'collapsed'
      localStorage.setItem('gitmd-sidebar', 'collapsed')
    }
  }

  function onResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    dragging.current = true
    document.documentElement.classList.add('sidebar-dragging')
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)

    const onMove = (ev: PointerEvent) => {
      if (!dragging.current) return
      // 手柄中线 = 左边距*2 + 宽度
      const w = Math.round(ev.clientX - 2 * 12)
      const clamped = Math.min(MAX_W, Math.max(MIN_W, w))
      document.documentElement.style.setProperty('--sidebar-w', clamped + 'px')
    }
    const onUp = () => {
      dragging.current = false
      document.documentElement.classList.remove('sidebar-dragging')
      const current = parseInt(document.documentElement.style.getPropertyValue('--sidebar-w'), 10)
      if (current >= MIN_W && current <= MAX_W) {
        localStorage.setItem('gitmd-sidebar-w', String(current))
      }
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  return (
    <>
      <TopNav user={user} onMenuClick={() => setSidebarOpen(true)} onToggleSidebar={toggleCollapse} />
      <Sidebar
        tree={tree}
        repoReady={repoReady}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {/* 拖拽调宽手柄：对齐侧边栏右缘 */}
      <div className="sidebar-resizer" onPointerDown={onResizeStart} aria-hidden />
      <main className="main-content">{children}</main>
    </>
  )
}
