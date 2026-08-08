import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { aiEnabled, streamAssist, ASSIST_ACTIONS, type AssistAction } from '@/lib/ai/chat'
import { runWithLimit } from '@/lib/ai/limiter'

/** 编辑器 AI 辅助：选区文字变换（润色/续写/翻译/起标题/总结），NDJSON 流式 */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (!aiEnabled()) {
    return NextResponse.json({ error: 'AI 未配置' }, { status: 503 })
  }

  const { action, text } = await req.json().catch(() => ({}))
  if (typeof action !== 'string' || !(action in ASSIST_ACTIONS)) {
    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 6000) {
    return NextResponse.json({ error: '文字为空或过长（≤6000 字）' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      await runWithLimit(user.id, () => send({ type: 'activity', text: '排队中…' }), async () => {
        try {
          for await (const ev of streamAssist(action as AssistAction, text.trim(), req.signal)) {
            send(ev)
          }
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : '生成失败' })
        }
      })
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
