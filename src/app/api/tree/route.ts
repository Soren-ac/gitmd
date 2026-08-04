import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { buildTree } from '@/lib/content/docs'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  return NextResponse.json({ tree: buildTree() })
}
