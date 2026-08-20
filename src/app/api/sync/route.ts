import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { getSyncState } from '@/lib/core/db'
import { isRepoCloned } from '@/lib/git/git'
import { triggerSync } from '@/lib/git/sync'
import { config } from '@/lib/core/config'

// 只读状态：匿名可访问；repoUrl 仅登录用户可见（避免向匿名访客泄露仓库地址）
export async function GET() {
  const user = await getSessionUser()
  return NextResponse.json({
    repoCloned: isRepoCloned(),
    ...(user ? { repoUrl: config.repoUrl ? config.repoUrl.replace(/\/\/.*@/, '//***@') : '' } : {}),
    branch: config.branch,
    pollIntervalMs: config.pollIntervalMs,
    state: getSyncState() ?? null,
  })
}

export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  const result = await triggerSync()
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
