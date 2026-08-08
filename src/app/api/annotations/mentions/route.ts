import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser } from '@/lib/auth/auth'
import { getSetting, setSetting } from '@/lib/core/db'
import { config } from '@/lib/core/config'
import { readAnnotations } from '@/lib/annotations/annotations'

interface MentionItem {
  annotationId: string
  doc: string
  quote: string
  author: string
  body: string
  at: string
}

function seenKey(userId: number) {
  return `mentions_seen_at:${userId}`
}

/** 扫描全部批注 sidecar，收集「@当前用户」且晚于已读时间的评论 */
function collectMentions(names: string[], seenAt: string, selfNames: string[]): MentionItem[] {
  const root = path.join(config.repoDir, '.gitmd', 'annotations')
  const items: MentionItem[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(abs)
        continue
      }
      if (!e.name.endsWith('.yaml')) continue
      const docRel = path.relative(root, abs).split(path.sep).join('/').replace(/\.yaml$/, '')
      for (const ann of readAnnotations(docRel)) {
        for (const c of ann.comments) {
          if (selfNames.includes(c.author)) continue
          if (seenAt && c.at <= seenAt) continue
          if (names.some((n) => c.body.includes('@' + n))) {
            items.push({
              annotationId: ann.id,
              doc: ann.doc,
              quote: ann.anchor.quote,
              author: c.author,
              body: c.body,
              at: c.at,
            })
          }
        }
      }
    }
  }
  walk(root)
  return items.sort((a, b) => b.at.localeCompare(a.at))
}

/** 当前用户的未读提及 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const names = [...new Set([user.username, user.git_name?.trim()].filter((s): s is string => Boolean(s)))]
  const seenAt = getSetting(seenKey(user.id)) ?? ''
  const items = collectMentions(names, seenAt, names)
  return NextResponse.json({ count: items.length, items: items.slice(0, 20) })
}

/** 标记提及全部已读 */
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  setSetting(seenKey(user.id), new Date().toISOString())
  return NextResponse.json({ ok: true })
}
