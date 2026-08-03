import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { buildTree } from '@/lib/docs'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  return NextResponse.json({ tree: buildTree() })
}
