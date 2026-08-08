import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { aiEnabled, getAiConfig } from '@/lib/ai/chat'

/** AI 对话是否可用（前端据此决定是否展示入口）；不暴露密钥 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const cfg = getAiConfig()
  return NextResponse.json({ enabled: aiEnabled(), model: cfg.model || 'default', source: cfg.source })
}
