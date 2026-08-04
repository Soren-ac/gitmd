import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { db } from '@/lib/core/db'

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** 设置当前用户的 git author 身份（name + email） */
export async function PUT(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { gitName, gitEmail } = await req.json().catch(() => ({}))
  if (typeof gitName !== 'string' || typeof gitEmail !== 'string') {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const name = gitName.trim()
  const email = gitEmail.trim()
  if (name.length < 1 || name.length > 64 || /[<>"'\\\n\r]/.test(name)) {
    return NextResponse.json({ error: '用户名长度 1-64，不能包含 < > " \' \\ 等字符' }, { status: 400 })
  }
  if (!EMAIL_RE.test(email) || email.length > 128) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 })
  }
  db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?').run(name, email, user.id)
  return NextResponse.json({ ok: true, gitName: name, gitEmail: email })
}
