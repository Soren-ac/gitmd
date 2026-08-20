import { NextResponse } from 'next/server'
import { resolveSafe, toRel } from '@/lib/content/docs'
import { diffBetween, withGitLock } from '@/lib/git/git'

// 只读接口：匿名可访问
export async function GET(req: Request) {
  const url = new URL(req.url)
  const file = url.searchParams.get('path') ?? ''
  const from = url.searchParams.get('from') ?? ''
  const to = url.searchParams.get('to') ?? ''
  const abs = resolveSafe([file])
  const refRe = /^[0-9a-f]{6,40}\^?$/i
  if (!abs || !refRe.test(from) || !refRe.test(to)) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  try {
    const diff = await withGitLock(() => diffBetween(toRel(abs), from, to))
    return NextResponse.json({ diff })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'diff 失败' }, { status: 500 })
  }
}
