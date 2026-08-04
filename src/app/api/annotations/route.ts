import { NextResponse } from 'next/server'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { locateAnnotations, locateForCreate, makeAnnotation, saveNew } from '@/lib/annotations/annotations'
import { resolveSafe, toRel } from '@/lib/content/docs'
import { git, withGitLock, withWriteOp } from '@/lib/git/git'
import fs from 'node:fs'
import { splitFrontmatter } from '@/lib/markdown/frontmatter'

function resolveDocRel(raw: string): string | null {
  const abs = resolveSafe([raw])
  if (!abs || !/\.mdx?$/i.test(abs)) return null
  return toRel(abs)
}

/** 列出文档批注（含当前版本的重定位结果） */
export async function GET(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const doc = new URL(req.url).searchParams.get('path') ?? ''
  const rel = resolveDocRel(doc)
  if (!rel) return NextResponse.json({ error: '非法路径' }, { status: 400 })
  const list = await locateAnnotations(rel)
  return NextResponse.json({ annotations: list })
}

/** 新建批注 {path, quote, estStart, estEnd, section, body} */
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
  const { path: docPath, quote, estStart, estEnd, section, body } = await req.json().catch(() => ({}))
  if (typeof docPath !== 'string' || typeof quote !== 'string' || !quote.trim() || typeof body !== 'string' || !body.trim()) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const rel = resolveDocRel(docPath)
  if (!rel) return NextResponse.json({ error: '非法路径' }, { status: 400 })

  const abs = resolveSafe([rel])!
  const raw = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : ''
  const content = splitFrontmatter(raw).body // 锚点基于正文坐标系，与渲染节点一致
  const located = locateForCreate(content, quote.trim(), Number(estStart) || 0, Number(estEnd) || 0)
  if (!located) {
    return NextResponse.json({ error: '未能在源码中定位所选文本，请重新选择' }, { status: 400 })
  }

  const base = await withGitLock(() => git.revparse(['HEAD']).catch(() => ''))
  const annotation = makeAnnotation(
    rel,
    {
      quote: quote.trim(),
      prefix: located.prefix,
      suffix: located.suffix,
      start: located.start,
      end: located.end,
      base,
      section: typeof section === 'string' ? section.slice(0, 120) : '',
    },
    identity.name,
    body.trim().slice(0, 2000),
  )

  try {
    await withWriteOp(
      { message: `comment: add on ${rel}`, author: identity },
      () => saveNew(rel, annotation),
    )
    return NextResponse.json({ ok: true, id: annotation.id })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '保存失败' }, { status: 500 })
  }
}
