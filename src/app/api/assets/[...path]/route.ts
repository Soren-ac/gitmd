import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
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

// 只读接口：匿名可访问（文档中的图片/附件需要随页面公开）
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
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
  // 转存图片按内容哈希命名（ext-<hash>.<ext>），内容不可变 → 长缓存；
  // 仓库内其他路径的文件可能随提交变化 → 短缓存（内容已公开，允许共享缓存）
  const immutable = /^ext-[0-9a-f]{16}\.[\w]+$/.test(path.basename(abs))
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    },
  })
}
