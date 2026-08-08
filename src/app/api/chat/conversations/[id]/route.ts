import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { getConversation, listChatMessages, deleteConversation } from '@/lib/core/db'

type Ctx = { params: Promise<{ id: string }> }

/** 会话的全部消息（仅本人） */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const { id } = await ctx.params
  const conv = getConversation(id)
  if (!conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: '会话不存在' }, { status: 404 })
  }
  return NextResponse.json({
    conversation: { id: conv.id, title: conv.title, createdAt: conv.created_at, updatedAt: conv.updated_at },
    messages: listChatMessages(conv.id).map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.created_at })),
  })
}

/** 删除会话（仅本人） */
export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const { id } = await ctx.params
  const conv = getConversation(id)
  if (!conv || conv.user_id !== user.id) {
    return NextResponse.json({ error: '会话不存在' }, { status: 404 })
  }
  deleteConversation(id, user.id)
  return NextResponse.json({ ok: true })
}
