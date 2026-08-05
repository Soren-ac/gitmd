import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser } from '@/lib/auth/auth'
import { resolveSafe } from '@/lib/content/docs'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
}

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })

  const { path: segments } = await ctx.params
  const abs = resolveSafe(segments)
  if (!abs || abs.split(path.sep).includes('.git')) {
    return NextResponse.json({ error: '非法路径' }, { status: 400 })
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404 })
  }
  const data = fs.readFileSync(abs)
  const type = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  return new NextResponse(new Uint8Array(data), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=60' },
  })
}
