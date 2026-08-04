import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { resolveSafe, readDoc, contentHash, toRel } from '@/lib/content/docs'
import { withWriteOp, ConflictError } from '@/lib/git/git'
import { indexFile, removeFromIndex } from '@/lib/search/search'
import { splitFrontmatter } from '@/lib/markdown/frontmatter'
import { extractTitle } from '@/lib/content/docs'

type Ctx = { params: Promise<{ path: string[] }> }

function identityRequired() {
  return NextResponse.json(
    { error: '请先在「设置」中配置 Git 用户名和邮箱', identityRequired: true },
    { status: 403 },
  )
}

/** commit message 清洗：单行、限长 */
function sanitizeMessage(msg: unknown, fallback: string): string {
  if (typeof msg !== 'string') return fallback
  const cleaned = msg.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  return cleaned || fallback
}

async function resolveMd(ctx: Ctx): Promise<{ abs: string; rel: string } | NextResponse> {
  const { path: segments } = await ctx.params
  const abs = resolveSafe(segments)
  if (!abs || !/\.mdx?$/i.test(abs)) {
    return NextResponse.json({ error: '非法路径' }, { status: 400 })
  }
  return { abs, rel: toRel(abs) }
}

/** 读文档：返回原始内容 + 内容哈希（乐观锁基线） */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const resolved = await resolveMd(ctx)
  if (resolved instanceof NextResponse) return resolved
  const doc = readDoc(resolved.abs)
  if (!doc.exists) return NextResponse.json({ error: '文档不存在' }, { status: 404 })
  return NextResponse.json({
    path: resolved.rel,
    content: doc.content,
    frontmatter: doc.frontmatter,
    body: doc.body,
    title: doc.title,
    hash: doc.hash,
  })
}

/** 保存文档（新建或更新），携带 baseHash 做乐观锁；message 可自定义提交说明 */
export async function PUT(req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const identity = gitIdentityOf(user)
  if (!identity) return identityRequired()
  const resolved = await resolveMd(ctx)
  if (resolved instanceof NextResponse) return resolved

  const { content, baseHash, message } = await req.json().catch(() => ({}))
  if (typeof content !== 'string' || typeof baseHash !== 'string') {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  // 入队前先检查一次，快速失败；文件不存在时基线哈希为空串
  const before = readDoc(resolved.abs)
  const beforeHash = before.exists ? contentHash(before.content) : ''
  if (beforeHash !== baseHash) {
    return NextResponse.json(
      { error: '文档已被他人修改', conflict: true, currentContent: before.content, currentHash: beforeHash },
      { status: 409 },
    )
  }

  try {
    const { head } = await withWriteOp(
      {
        message: sanitizeMessage(message, `docs: ${before.exists ? 'update' : 'create'} ${resolved.rel}`),
        author: identity,
      },
      async () => {
        // 队列等待期间可能又有变更，二次校验
        const now = readDoc(resolved.abs)
        const nowHash = now.exists ? contentHash(now.content) : ''
        if (nowHash !== baseHash) {
          throw new ConflictError('文档已被他人修改', now.content, nowHash)
        }
        fs.mkdirSync(path.dirname(resolved.abs), { recursive: true })
        fs.writeFileSync(resolved.abs, content, 'utf8')
      },
    )
    const { body } = splitFrontmatter(content)
    indexFile(resolved.rel, extractTitle(content, path.basename(resolved.rel)), body)
    return NextResponse.json({ ok: true, head, hash: contentHash(content) })
  } catch (err) {
    if (err instanceof ConflictError) {
      return NextResponse.json(
        { error: err.message, conflict: true, currentContent: err.currentContent ?? '', currentHash: err.currentHash ?? '' },
        { status: 409 },
      )
    }
    console.error('[gitmd] 保存失败:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : '保存失败' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  const identity = gitIdentityOf(user)
  if (!identity) return identityRequired()
  const resolved = await resolveMd(ctx)
  if (resolved instanceof NextResponse) return resolved
  if (!fs.existsSync(resolved.abs)) {
    return NextResponse.json({ error: '文档不存在' }, { status: 404 })
  }
  try {
    const { head } = await withWriteOp(
      { message: `docs: delete ${resolved.rel}`, author: identity },
      () => fs.unlinkSync(resolved.abs),
    )
    removeFromIndex(resolved.rel)
    return NextResponse.json({ ok: true, head })
  } catch (err) {
    console.error('[gitmd] 删除失败:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : '删除失败' }, { status: 500 })
  }
}
