import { NextResponse } from 'next/server'
import fs from 'node:fs'
import { getSessionUser } from '@/lib/auth/auth'
import {
  createConversation,
  getConversation,
  setConversationSession,
  addChatMessage,
  touchConversation,
} from '@/lib/core/db'
import { resolveSafe } from '@/lib/content/docs'
import { aiEnabled, streamChat } from '@/lib/ai/chat'
import { runWithLimit } from '@/lib/ai/limiter'

/** 把前端给的文档路径解析为仓库内真实存在的 md 文件（支持目录 README 形式）；无效返回 null */
function resolveDocPath(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const clean = input.trim().replace(/^\/+/, '')
  if (clean.split('/').some((s) => !s || s === '.' || s === '..')) return null
  const candidates = /\.mdx?$/i.test(clean)
    ? [clean]
    : [`${clean}.md`, `${clean}/README.md`, `${clean}/index.md`]
  for (const rel of candidates) {
    const abs = resolveSafe([rel])
    if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) return rel
  }
  return null
}

/**
 * 发起一轮 AI 对话（NDJSON 流式）。
 * 事件序列：meta（会话 id）→ session（Claude 会话 id）→ activity/delta… → done / error
 * 新会话可带 docPath：把「用户正在阅读该文档」注入首轮 prompt（仅注入指引，内容由 agent 用 Read 精读）
 */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (!aiEnabled()) {
    return NextResponse.json({ error: 'AI 对话未配置，请联系管理员在「平台管理 → AI 对话」中设置模型端点' }, { status: 503 })
  }

  const { conversationId, message, docPath } = await req.json().catch(() => ({}))
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return NextResponse.json({ error: '消息为空或过长（≤4000 字）' }, { status: 400 })
  }
  const text = message.trim()
  const contextDoc = resolveDocPath(docPath)

  let conv
  if (typeof conversationId === 'string' && conversationId) {
    conv = getConversation(conversationId)
    if (!conv || conv.user_id !== user.id) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }
  } else {
    const id = crypto.randomUUID()
    createConversation(id, user.id, text.slice(0, 40), contextDoc)
    conv = getConversation(id)!
  }

  // 首轮且带上下文文档：包装发给模型的 prompt（用户可见消息保持原文）
  const promptText =
    !conv.session_id && conv.doc_path
      ? `[上下文] 用户正在阅读文档「${conv.doc_path}」（仓库相对路径）。当问题中出现「这篇/本文/这个文档」等指代时，优先用 Read 阅读该文档并基于它回答；与它无关的问题正常全库检索。\n\n用户问题：${text}`
      : text

  addChatMessage(conv.id, 'user', text)
  touchConversation(conv.id)
  const sessionId = conv.session_id

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      send({ type: 'meta', conversationId: conv.id })
      const parts: string[] = []
      let doneText = ''
      // 限流：同用户串行、全局并发上限；排队时先告知前端
      await runWithLimit(
        user.id,
        () => send({ type: 'activity', text: '排队中，前面的回答完成后开始…' }),
        async () => {
          try {
            for await (const ev of streamChat(promptText, sessionId, req.signal)) {
              if (ev.type === 'session') {
                setConversationSession(conv.id, ev.sessionId)
              } else if (ev.type === 'delta') {
                parts.push(ev.text)
              } else if (ev.type === 'done') {
                doneText = ev.fullText
              } else if (ev.type === 'error') {
                console.error('[gitmd] AI 对话失败:', ev.error)
              }
              send(ev)
            }
          } catch (err) {
            send({ type: 'error', error: err instanceof Error ? err.message : '对话失败' })
          }
        },
      )
      // 出错/中止也保留已生成的部分内容；完整文本优先用 done 的汇总（块边界已正确计入）
      const content = doneText || parts.join('')
      if (content) addChatMessage(conv.id, 'assistant', content)
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
