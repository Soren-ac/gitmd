import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import {
  createConversation,
  getConversation,
  setConversationSession,
  addChatMessage,
  touchConversation,
} from '@/lib/core/db'
import { aiEnabled, streamChat } from '@/lib/ai/chat'

/**
 * 发起一轮 AI 对话（NDJSON 流式）。
 * 事件序列：meta（会话 id）→ session（Claude 会话 id）→ activity/delta… → done / error
 */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (!aiEnabled()) {
    return NextResponse.json({ error: 'AI 对话未配置，请联系管理员在「平台管理 → AI 对话」中设置模型端点' }, { status: 503 })
  }

  const { conversationId, message } = await req.json().catch(() => ({}))
  if (typeof message !== 'string' || !message.trim() || message.length > 4000) {
    return NextResponse.json({ error: '消息为空或过长（≤4000 字）' }, { status: 400 })
  }
  const text = message.trim()

  let conv
  if (typeof conversationId === 'string' && conversationId) {
    conv = getConversation(conversationId)
    if (!conv || conv.user_id !== user.id) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 })
    }
  } else {
    const id = crypto.randomUUID()
    createConversation(id, user.id, text.slice(0, 40))
    conv = getConversation(id)!
  }

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
      try {
        for await (const ev of streamChat(text, sessionId, req.signal)) {
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
      } finally {
        // 出错/中止也保留已生成的部分内容；完整文本优先用 done 的汇总（块边界已正确计入）
        const content = doneText || parts.join('')
        if (content) addChatMessage(conv.id, 'assistant', content)
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
