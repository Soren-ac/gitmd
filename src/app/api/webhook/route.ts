import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { getWebhookSecret } from '@/lib/core/db'
import { triggerSync } from '@/lib/git/sync'

function checkToken(req: Request): boolean {
  // 管理界面配置（DB）优先，其次 WEBHOOK_SECRET 环境变量
  const secret = getWebhookSecret()
  if (!secret) return false
  const url = new URL(req.url)
  const token =
    url.searchParams.get('token') ??
    req.headers.get('x-gitmd-token') ??
    req.headers.get('x-codehub-token') ??
    ''
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handler(req: Request) {
  if (!checkToken(req)) {
    return NextResponse.json({ error: '验签失败' }, { status: 401 })
  }
  const result = await triggerSync()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

export { handler as POST, handler as GET }
