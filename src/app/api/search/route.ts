import { NextResponse } from 'next/server'
import { countDocs, searchDocs } from '@/lib/search/search'

const PAGE_SIZE = 30
const MAX_LIMIT = 100

// 只读接口：匿名可访问
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const q = sp.get('q') ?? ''
  // 命令面板等旧调用方不带分页参数，行为不变（前 30 条）
  const limit = Math.min(Math.max(1, Number(sp.get('limit')) || PAGE_SIZE), MAX_LIMIT)
  const offset = Math.max(0, Number(sp.get('offset')) || 0)
  const total = countDocs(q)
  const results = searchDocs(q, limit, offset)
  return NextResponse.json({ results, total, hasMore: offset + results.length < total })
}
