import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { resolveSafe } from '@/lib/content/docs'
import { localizeExternalImages } from '@/lib/content/images'
import { withWriteOp } from '@/lib/git/git'

/**
 * 手动转存：把 content 中的外链图片下载到 assets/ 并提交推送，
 * 返回重写后的 content 由前端替换编辑器缓冲（文档本身由用户随后保存）。
 * 图片文件名是内容哈希，放弃保存留下的孤儿文件无害且可被后续复用。
 */
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

  const { content } = await req.json().catch(() => ({}))
  if (typeof content !== 'string') {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }

  let loc
  try {
    loc = await localizeExternalImages(content)
  } catch (err) {
    console.error('[gitmd] 外链图片转存异常:', err)
    return NextResponse.json({ error: '转存失败' }, { status: 500 })
  }

  let head = ''
  if (loc.files.length > 0) {
    try {
      const r = await withWriteOp(
        { message: `assets: 转存 ${loc.files.length} 张外链图片`, author: identity },
        () => {
          for (const f of loc.files) {
            const abs = resolveSafe([f.rel])
            if (!abs || fs.existsSync(abs)) continue // 内容哈希同名即同内容
            fs.mkdirSync(path.dirname(abs), { recursive: true })
            fs.writeFileSync(abs, f.buf)
          }
        },
      )
      head = r.head
    } catch (err) {
      console.error('[gitmd] 转存图片提交失败:', err)
      return NextResponse.json({ error: err instanceof Error ? err.message : '提交失败' }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    head,
    content: loc.content,
    localized: loc.localized.length,
    failed: loc.failed,
  })
}
