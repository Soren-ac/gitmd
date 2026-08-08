import { NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { getSessionUser, gitIdentityOf } from '@/lib/auth/auth'
import { config } from '@/lib/core/config'
import { listMarkdownFiles, resolveSafe } from '@/lib/content/docs'
import { withWriteOp } from '@/lib/git/git'

function adminOnly(user: { role: string } | null) {
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
  return null
}

function listAssetFiles(): { rel: string; size: number; mtime: string }[] {
  const dir = path.join(config.repoDir, 'assets')
  if (!fs.existsSync(dir)) return []
  const out: { rel: string; size: number; mtime: string }[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) continue
    const st = fs.statSync(path.join(dir, e.name))
    out.push({ rel: `assets/${e.name}`, size: st.size, mtime: st.mtime.toISOString() })
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** 扫描 assets/ 中未被任何 md 文件引用的孤儿文件 */
export async function GET() {
  const user = await getSessionUser()
  const deny = adminOnly(user)
  if (deny) return deny

  const assets = listAssetFiles()
  // 全库 md 内容拼接后做引用检测（仓库规模下一次性读取足够快）
  const corpus = listMarkdownFiles()
    .map((rel) => {
      try {
        return fs.readFileSync(path.join(config.repoDir, rel), 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')

  const orphans = assets.filter((a) => {
    const base = path.basename(a.rel)
    // 引用形态：/assets/xxx、assets/xxx、或仅文件名
    return !corpus.includes(a.rel) && !corpus.includes(`/${base}`) && !corpus.includes(base)
  })
  const totalSize = assets.reduce((s, a) => s + a.size, 0)
  const orphanSize = orphans.reduce((s, a) => s + a.size, 0)
  return NextResponse.json({ total: assets.length, totalSize, orphans, orphanSize })
}

/** 清理孤儿文件 { files: string[] }（限定 assets/ 目录内） */
export async function POST(req: Request) {
  const user = await getSessionUser()
  const deny = adminOnly(user)
  if (deny) return deny
  const identity = gitIdentityOf(user!)
  if (!identity) {
    return NextResponse.json(
      { error: '请先在「设置」中配置 Git 用户名和邮箱', identityRequired: true },
      { status: 403 },
    )
  }

  const { files } = await req.json().catch(() => ({}))
  if (!Array.isArray(files) || files.length === 0 || files.length > 500) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const targets: string[] = []
  for (const f of files) {
    if (typeof f !== 'string' || !f.startsWith('assets/')) continue
    const abs = resolveSafe([f])
    if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) targets.push(abs)
  }
  if (targets.length === 0) {
    return NextResponse.json({ error: '没有可清理的文件' }, { status: 400 })
  }

  try {
    const { head } = await withWriteOp(
      { message: `assets: 清理 ${targets.length} 个未引用文件`, author: identity },
      () => {
        for (const abs of targets) fs.unlinkSync(abs)
      },
    )
    return NextResponse.json({ ok: true, head, deleted: targets.length })
  } catch (err) {
    console.error('[gitmd] 清理 assets 失败:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : '清理失败' }, { status: 500 })
  }
}
