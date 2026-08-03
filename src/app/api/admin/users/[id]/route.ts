import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth-core'

type Ctx = { params: Promise<{ id: string }> }

/** 改密码：本人可改自己，admin 可改任何人 */
export async function PUT(req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const { id } = await ctx.params
  const targetId = Number(id)
  if (!Number.isInteger(targetId)) return NextResponse.json({ error: '参数错误' }, { status: 400 })
  if (user.role !== 'admin' && user.id !== targetId) {
    return NextResponse.json({ error: '无权修改其他用户' }, { status: 403 })
  }
  const { password } = await req.json().catch(() => ({}))
  if (typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 })
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), targetId)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  const { id } = await ctx.params
  const targetId = Number(id)
  if (targetId === user.id) return NextResponse.json({ error: '不能删除自己' }, { status: 400 })
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId)
  return NextResponse.json({ ok: true })
}
