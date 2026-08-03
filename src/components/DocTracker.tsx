'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const KEY = 'gitmd-recent'
const MAX = 6

export interface RecentItem {
  path: string
  title: string
  ts: number
}

export function getRecent(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentItem[]
  } catch {
    return []
  }
}

/** 记录文档访问历史（供命令面板的"最近访问"） */
export default function DocTracker({ path, title }: { path: string; title: string }) {
  const pathname = usePathname()
  useEffect(() => {
    if (!path) return
    const list = getRecent().filter((r) => r.path !== path)
    list.unshift({ path, title, ts: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  }, [path, title, pathname])
  return null
}
