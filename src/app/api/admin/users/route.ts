import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { db } from '@/lib/core/db'
import { hashPassword } from '@/lib/auth/auth-core'
import type { UserRow } from '@/lib/core/db'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id').all()
  return NextResponse.json({ users })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })

  const { username, password, role } = await req.json().catch(() => ({}))
  if (
    typeof username !== 'string' ||
    !/^[\w.-]{2,32}$/.test(username) ||
    typeof password !== 'string' ||
    password.length < 6
  ) {
    return NextResponse.json({ error: '用户名 2-32 位字母数字，密码至少 6 位' }, { status: 400 })
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as UserRow | undefined
  if (exists) return NextResponse.json({ error: '用户名已存在' }, { status: 409 })
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
    username,
    hashPassword(password),
    role === 'admin' ? 'admin' : 'member',
  )
  return NextResponse.json({ ok: true })
}
