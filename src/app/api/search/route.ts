import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { searchDocs } from '@/lib/search'

export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const q = new URL(req.url).searchParams.get('q') ?? ''
  return NextResponse.json({ results: searchDocs(q) })
}
