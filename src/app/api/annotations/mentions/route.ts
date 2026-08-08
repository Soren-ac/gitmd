import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { getSetting, setSetting } from '@/lib/core/db'
import { getAllAnnotations } from '@/lib/annotations/all'

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

/** 从全库批注快照收集「@当前用户」且晚于已读时间的评论 */
function collectMentions(names: string[], seenAt: string, selfNames: string[]): MentionItem[] {
  const items: MentionItem[] = []
  for (const ann of getAllAnnotations()) {
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
