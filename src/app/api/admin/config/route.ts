import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getSessionUser } from '@/lib/auth/auth'
import { getSetting, setSetting, deleteSetting } from '@/lib/core/db'
import { config } from '@/lib/core/config'

function forbidden() {
  return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
}

/** 当前 webhook 密钥的来源：界面配置（DB）> 环境变量 > 未配置 */
function webhookInfo() {
  const fromDb = getSetting('webhook_secret')
  if (fromDb) return { secret: fromDb, source: 'db' as const }
  if (config.webhookSecret) return { secret: config.webhookSecret, source: 'env' as const }
  return { secret: '', source: 'none' as const }
}

/** 读平台配置（admin）。webhook 密钥完整返回——admin 需要把它复制到 CodeHub */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return forbidden()
  return NextResponse.json({ webhook: webhookInfo() })
}

/** 保存 webhook 密钥（admin）；空串 = 清除界面配置，回退到环境变量 */
export async function PUT(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return forbidden()

  const { webhookSecret } = await req.json().catch(() => ({}))
  if (typeof webhookSecret !== 'string') {
    return NextResponse.json({ error: '参数错误' }, { status: 400 })
  }
  const secret = webhookSecret.trim()
  if (secret && secret.length < 16) {
    return NextResponse.json({ error: '密钥至少 16 个字符' }, { status: 400 })
  }
  if (/[\r\n]/.test(secret)) {
    return NextResponse.json({ error: '密钥不能包含换行' }, { status: 400 })
  }
  if (secret) setSetting('webhook_secret', secret)
  else deleteSetting('webhook_secret')
  return NextResponse.json({ ok: true, webhook: webhookInfo() })
}

/** 生成随机密钥并保存（admin） */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return forbidden()

  const { action } = await req.json().catch(() => ({}))
  if (action !== 'generate') {
    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  }
  setSetting('webhook_secret', randomBytes(24).toString('hex'))
  return NextResponse.json({ ok: true, webhook: webhookInfo() })
}
