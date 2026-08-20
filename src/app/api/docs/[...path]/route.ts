import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { resolveSafe, readDoc, contentHash, toRel } from '@/lib/content/docs'
import { localizeExternalImages, type LocalizeResult } from '@/lib/content/images'
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

  // 外链图片转存：网络下载放在串行队列外，避免阻塞其他写操作；
  // 转存异常不阻断保存（保留原始外链）
  let loc: LocalizeResult | null = null
  try {
    loc = await localizeExternalImages(content)
  } catch (err) {
    console.error('[gitmd] 外链图片转存异常:', err)
  }
  const finalContent = loc?.content ?? content
  const imgNote = loc && loc.localized.length > 0 ? `（转存 ${loc.localized.length} 张外链图片）` : ''

  // NDJSON 流式响应：committed → pushed 阶段事件 + 最终结果，前端据此分阶段提示
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        const { head } = await withWriteOp(
          {
            message: sanitizeMessage(message, `docs: ${before.exists ? 'update' : 'create'} ${resolved.rel}`) + imgNote,
            author: identity,
          },
          async () => {
            // 队列等待期间可能又有变更，二次校验
            const now = readDoc(resolved.abs)
            const nowHash = now.exists ? contentHash(now.content) : ''
            if (nowHash !== baseHash) {
              throw new ConflictError('文档已被他人修改', now.content, nowHash)
            }
            for (const f of loc?.files ?? []) {
              const abs = resolveSafe([f.rel])
              if (!abs || fs.existsSync(abs)) continue // 内容哈希同名即同内容
              fs.mkdirSync(path.dirname(abs), { recursive: true })
              fs.writeFileSync(abs, f.buf)
            }
            fs.mkdirSync(path.dirname(resolved.abs), { recursive: true })
            fs.writeFileSync(resolved.abs, finalContent, 'utf8')
          },
          (stage) => send({ stage }),
        )
        const { body } = splitFrontmatter(finalContent)
        indexFile(resolved.rel, extractTitle(finalContent, path.basename(resolved.rel)), body)
        send({
          stage: 'done',
          ok: true,
          head,
          hash: contentHash(finalContent),
          // 转存改写了内容时回传，前端同步编辑器状态
          ...(finalContent !== content ? { content: finalContent } : {}),
          ...(loc && (loc.localized.length > 0 || loc.failed.length > 0)
            ? { images: { localized: loc.localized.length, failed: loc.failed.length } }
            : {}),
        })
      } catch (err) {
        if (err instanceof ConflictError) {
          send({
            stage: 'error',
            conflict: true,
            error: err.message,
            currentContent: err.currentContent ?? '',
            currentHash: err.currentHash ?? '',
          })
        } else {
          console.error('[gitmd] 保存失败:', err)
          send({ stage: 'error', error: err instanceof Error ? err.message : '保存失败' })
        }
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
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
  // NDJSON 流式：committed（本地提交完成，推送在后台继续）→ done/error
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        const { head } = await withWriteOp(
          { message: `docs: delete ${resolved.rel}`, author: identity },
          () => fs.unlinkSync(resolved.abs),
          (stage) => send({ stage }),
        )
        removeFromIndex(resolved.rel)
        send({ stage: 'done', ok: true, head })
      } catch (err) {
        console.error('[gitmd] 删除失败:', err)
        send({ stage: 'error', error: err instanceof Error ? err.message : '删除失败' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
