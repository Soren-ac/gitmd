import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { resolveSafe, readDoc } from '@/lib/content/docs'
import { withWriteOp } from '@/lib/git/git'
import { indexFile, removeFromIndex } from '@/lib/search/search'
import { splitFrontmatter } from '@/lib/markdown/frontmatter'

/** 重命名/移动文档 {from, to}；NDJSON 流式：committed（本地提交完成，推送在后台继续）→ done/error */
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

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      try {
        const { head } = await withWriteOp(
          { message: `docs: move ${from} -> ${toRel}`, author: identity },
          () => {
            fs.mkdirSync(path.dirname(toAbs), { recursive: true })
            fs.renameSync(fromAbs, toAbs)
          },
          (stage) => send(stage === 'committed' ? { stage, path: toRel } : { stage }),
        )
        removeFromIndex(from)
        const doc = readDoc(toAbs)
        const { body } = splitFrontmatter(doc.content)
        indexFile(toRel, doc.title, body)
        send({ stage: 'done', ok: true, head, path: toRel })
      } catch (err) {
        console.error('[gitmd] 移动失败:', err)
        send({ stage: 'error', error: err instanceof Error ? err.message : '移动失败' })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
