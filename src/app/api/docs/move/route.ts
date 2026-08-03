import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth'
import { resolveSafe, readDoc } from '@/lib/docs'
import { withWriteOp } from '@/lib/git'
import { indexFile, removeFromIndex } from '@/lib/search'
import { splitFrontmatter } from '@/lib/frontmatter'

/** 重命名/移动文档 {from, to} */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const identity = gitIdentityOf(user)
  if (!identity) {
    return NextResponse.json(
      { error: '请先在「设置」中配置 Git 用户名和邮箱', identityRequired: true },
      { status: 403 },
    )
  }

  const { from, to } = await req.json().catch(() => ({}))
  if (typeof from !== 'string' || typeof to !== 'string') {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const fromAbs = resolveSafe([from])
  const toRel = /\.mdx?$/i.test(to) ? to : `${to}.md`
  const toAbs = resolveSafe([toRel])
  if (!fromAbs || !toAbs || !/\.mdx?$/i.test(fromAbs)) {
    return NextResponse.json({ error: '非法路径' }, { status: 400 })
  }
  if (!fs.existsSync(fromAbs)) return NextResponse.json({ error: '源文件不存在' }, { status: 404 })
  if (fs.existsSync(toAbs)) return NextResponse.json({ error: '目标路径已存在' }, { status: 409 })

  try {
    const { head } = await withWriteOp(
      { message: `docs: move ${from} -> ${toRel}`, author: identity },
      () => {
        fs.mkdirSync(path.dirname(toAbs), { recursive: true })
        fs.renameSync(fromAbs, toAbs)
      },
    )
    removeFromIndex(from)
    const doc = readDoc(toAbs)
    const { body } = splitFrontmatter(doc.content)
    indexFile(toRel, doc.title, body)
    return NextResponse.json({ ok: true, head, path: toRel })
  } catch (err) {
    console.error('[gitmd] 移动失败:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : '移动失败' }, { status: 500 })
  }
}
