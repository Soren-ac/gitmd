import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { listConversations } from '@/lib/core/db'

/** 当前用户的会话列表（最近更新在前） */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const rows = listConversations(user.id)
  return NextResponse.json({
    conversations: rows.map((c) => ({
      id: c.id,
      title: c.title || '新对话',
      docPath: c.doc_path ?? null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    })),
  })
}
