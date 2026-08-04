import { NextResponse } from 'next/server'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { resolveSafe } from '@/lib/content/docs'
import { withWriteOp } from '@/lib/git/git'

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'])

/** 上传图片 → assets/ 目录并提交推送 */
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

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: '缺少文件' }, { status: 400 })
  }
  const ext = path.extname(file.name).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: `不支持的文件类型 ${ext}` }, { status: 400 })
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: '文件超过 10MB 限制' }, { status: 400 })
  }

  const safeName = `${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`
  const rel = `assets/${safeName}`
  const abs = resolveSafe([rel])
  if (!abs) return NextResponse.json({ error: '非法路径' }, { status: 400 })

  const buf = Buffer.from(await file.arrayBuffer())
  try {
    const { head } = await withWriteOp(
      { message: `assets: add ${rel}`, author: identity },
      async () => {
        const fs = await import('node:fs')
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, buf)
      },
    )
    return NextResponse.json({ ok: true, head, path: '/' + rel, url: '/api/assets/' + rel })
  } catch (err) {
    console.error('[gitmd] 上传失败:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : '上传失败' }, { status: 500 })
  }
}
