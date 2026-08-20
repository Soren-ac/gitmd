import { NextResponse } from 'next/server'
import { getDocTree } from '@/lib/content/docs'

// 只读接口：匿名可访问
export async function GET() {
  return NextResponse.json({ tree: getDocTree() })
}
