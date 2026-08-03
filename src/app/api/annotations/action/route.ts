import { NextResponse } from 'next/server'
import { getSessionUser, gitIdentityOf } from '@/lib/auth'
import { updateAnnotation, deleteAnnotation, readAnnotations } from '@/lib/annotations'
import { resolveSafe, toRel } from '@/lib/docs'
import { withWriteOp } from '@/lib/git'

/** 批注操作 {path, id, action: reply|resolve|delete, body?} */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const identity = gitIdentityOf(user)
  if (!identity) {
    return NextResponse.json(
      { error: '请先在「设置」中配置 Git 用户名和邮箱', identityRequired: true },
      { status: 403 },
    )
  }
  const { path: docPath, id, action, body } = await req.json().catch(() => ({}))
  const abs = resolveSafe([String(docPath ?? '')])
  if (!abs || typeof id !== 'string') return NextResponse.json({ error: '参数错误' }, { status: 400 })
  const rel = toRel(abs)

  if (action === 'reply' && (typeof body !== 'string' || !body.trim())) {
    return NextResponse.json({ error: '回复内容为空' }, { status: 400 })
  }
  if (!['reply', 'resolve', 'delete'].includes(String(action))) {
    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  }
  const message = `comment: ${action} on ${rel}`

  // 删除仅限批注作者本人（不设管理员例外）
  if (action === 'delete') {
    const target = readAnnotations(rel).find((a) => a.id === id)
    if (target && target.author !== identity.name) {
      return NextResponse.json({ error: '只能删除自己的批注' }, { status: 403 })
    }
  }

  let ok = false
  try {
    await withWriteOp({ message, author: identity }, () => {
      if (action === 'reply') {
        ok = updateAnnotation(rel, id, (a) => {
          // 回复只是讨论的一部分，不改变该批注的 resolved 状态
          a.comments.push({ author: identity.name, body: body.trim().slice(0, 2000), at: new Date().toISOString() })
        })
      } else if (action === 'resolve') {
        ok = updateAnnotation(rel, id, (a) => {
          a.resolved = !a.resolved
        })
      } else {
        ok = deleteAnnotation(rel, id)
      }
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '操作失败' }, { status: 500 })
  }
  if (!ok) return NextResponse.json({ error: '批注不存在' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
