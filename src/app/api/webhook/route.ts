import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { config } from '@/lib/core/config'
import { triggerSync } from '@/lib/git/sync'

function checkToken(req: Request): boolean {
  if (!config.webhookSecret) return false
  const url = new URL(req.url)
  const token =
    url.searchParams.get('token') ??
    req.headers.get('x-gitmd-token') ??
    req.headers.get('x-codehub-token') ??
    ''
  const a = Buffer.from(token)
  const b = Buffer.from(config.webhookSecret)
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
