'use client'

import { useState } from 'react'
import TopNav from './TopNav'
import Sidebar from './Sidebar'
import type { TreeNode } from '@/lib/docs'

interface Props {
  tree: TreeNode[]
  user: { username: string; role: string }
  repoReady: boolean
  children: React.ReactNode
}

export default function AppShell({ tree, user, repoReady, children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <>
      <TopNav user={user} onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        tree={tree}
        repoReady={repoReady}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="main-content">{children}</main>
    </>
  )
}
