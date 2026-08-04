'use client'

import { useEffect, useState } from 'react'
import type { TocItem } from '@/lib/markdown/markdown'

/** 右侧"本页目录"：滚动监听高亮当前章节，点击平滑滚动 */
export default function RightToc({ toc }: { toc: TocItem[] }) {
  const [activeId, setActiveId] = useState<string>('')

  useEffect(() => {
    if (toc.length === 0) return
    const headings = toc
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => !!el)
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [toc])

  if (toc.length === 0) return null

  return (
    <nav className="toc" aria-label="本页目录">
      <div className="toc-title">本页目录</div>
      <div className="toc-list">
        {toc.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={`toc-item depth-${item.depth} ${activeId === item.id ? 'active' : ''}`}
            onClick={(e) => {
              e.preventDefault()
              document.getElementById(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              setActiveId(item.id)
              history.replaceState(null, '', `#${item.id}`)
            }}
          >
            {item.text}
          </a>
        ))}
      </div>
    </nav>
  )
}
