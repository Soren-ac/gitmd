import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { resolveSafe, toRel } from '@/lib/content/docs'
import { fileLog, withGitLock } from '@/lib/git/git'

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
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
