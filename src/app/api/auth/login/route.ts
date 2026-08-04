import { NextResponse } from 'next/server'
import { db } from '@/lib/core/db'
import { verifyPassword } from '@/lib/auth/auth-core'
import { setSessionCookie } from '@/lib/auth/auth'
import type { UserRow } from '@/lib/core/db'

export async function POST(req: Request) {
  const { username, password } = await req.json().catch(() => ({}))
  if (typeof username !== 'string' || typeof password !== 'string') {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 })
  }
  await setSessionCookie(user.id)
  return NextResponse.json({ ok: true, username: user.username, role: user.role })
}
