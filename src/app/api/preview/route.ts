import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { renderMarkdownHtml } from '@/lib/markdown/markdown'

/** 编辑器实时预览：md 文本 → HTML */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const { content, docDir } = await req.json().catch(() => ({}))
  if (typeof content !== 'string') return NextResponse.json({ error: '参数错误' }, { status: 400 })
  const html = await renderMarkdownHtml(content, typeof docDir === 'string' ? docDir : '')
  return NextResponse.json({ html })
}
