'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { LogEntry } from '@/lib/git'

interface Props {
  entries: LogEntry[]
  path: string
}

function DiffView({ diff }: { diff: string }) {
  return (
    <div className="diff-view">
      {diff.split('\n').map((line, i) => {
        let cls = 'diff-line'
        if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del'
        else if (
          line.startsWith('@@') ||
          line.startsWith('diff ') ||
          line.startsWith('index ') ||
          line.startsWith('---') ||
          line.startsWith('+++')
        )
          cls += ' diff-hunk'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </div>
  )
}

export default function HistoryList({ entries, path }: Props) {
  const [openHash, setOpenHash] = useState('')
  const [diff, setDiff] = useState('')
  const [loading, setLoading] = useState(false)

  async function toggle(entry: LogEntry, index: number) {
    if (openHash === entry.hash) {
      setOpenHash('')
      setDiff('')
      return
    }
    setOpenHash(entry.hash)
    setLoading(true)
    setDiff('')
    // 与该提交的父提交对比；最早一条用 hash^ 兜底
    const parent = entries[index + 1]?.hash ?? `${entry.hash}^`
    const res = await fetch(`/api/diff?path=${encodeURIComponent(path)}&from=${parent}&to=${entry.hash}`)
    const data = await res.json().catch(() => ({}))
    setLoading(false)
    setDiff(res.ok ? data.diff || '（无文本差异）' : data.error ?? 'diff 加载失败')
  }

  return (
    <div>
      {entries.map((e, i) => (
        <div key={e.hash} className="commit-row">
          <div className="commit-head">
            <code className="commit-hash">{e.abbrev}</code>
            <span className="commit-msg" title={e.message}>
              {e.message}
            </span>
            <span className="commit-meta hide-sm">{e.author}</span>
            <span className="commit-meta">{new Date(e.date).toLocaleString('zh-CN')}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => toggle(e, i)}
              aria-expanded={openHash === e.hash}
            >
              <ChevronRight
                size={13}
                style={{
                  transform: openHash === e.hash ? 'rotate(90deg)' : 'none',
                  transition: 'transform 150ms',
                }}
              />
              变更
            </button>
          </div>
          {openHash === e.hash && (
            <div>
              {loading ? (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="skeleton" style={{ height: 14, width: '90%' }} />
                  <div className="skeleton" style={{ height: 14, width: '70%' }} />
                  <div className="skeleton" style={{ height: 14, width: '80%' }} />
                </div>
              ) : (
                <DiffView diff={diff} />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
