import { NextResponse } from 'next/server'
import { resolveSafe, toRel } from '@/lib/content/docs'
import { fileLog, withGitLock } from '@/lib/git/git'

// 只读接口：匿名可访问
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params
  const abs = resolveSafe(segments)
  if (!abs || !/\.mdx?$/i.test(abs)) return NextResponse.json({ error: '非法路径' }, { status: 400 })
  try {
    const entries = await withGitLock(() => fileLog(toRel(abs)))
    return NextResponse.json({ entries })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '读取历史失败' }, { status: 500 })
  }
}
