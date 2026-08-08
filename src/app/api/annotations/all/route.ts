import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/auth'
import { listAllAnnotations } from '@/lib/annotations/all'

/** 全库批注列表（批注中心用；提及检测复用同一份扫描） */
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const status = new URL(req.url).searchParams.get('status') // open | resolved | all
  let items = listAllAnnotations()
  if (status === 'open') items = items.filter((a) => !a.resolved)
  else if (status === 'resolved') items = items.filter((a) => a.resolved)
  return NextResponse.json({ annotations: items })
}
