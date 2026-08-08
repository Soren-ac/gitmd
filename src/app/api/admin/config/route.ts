import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { getSessionUser } from '@/lib/auth/auth'
import { getSetting, setSetting, deleteSetting } from '@/lib/core/db'
import { getAiConfig, aiEnabled } from '@/lib/ai/chat'
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

/** 读平台配置（admin）。密钥完整返回——admin 需要复制到 CodeHub/核对 */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return forbidden()
  const ai = getAiConfig()
  return NextResponse.json({
    webhook: webhookInfo(),
    ai: { baseUrl: ai.baseUrl, apiKey: ai.apiKey, model: ai.model, cliPath: ai.cliPath, source: ai.source },
  })
}

const AI_KEYS = ['aiBaseUrl', 'aiApiKey', 'aiModel', 'aiCliPath'] as const
const AI_SETTING_KEY: Record<(typeof AI_KEYS)[number], string> = {
  aiBaseUrl: 'ai_base_url',
  aiApiKey: 'ai_api_key',
  aiModel: 'ai_model',
  aiCliPath: 'ai_cli_path',
}

/** 保存配置（admin）。webhook 密钥空串 = 清除回退环境变量；AI 各字段空串 = 清除该项界面配置 */
export async function PUT(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return forbidden()

  const body = await req.json().catch(() => ({}))

  if (typeof body.webhookSecret === 'string') {
    const secret = body.webhookSecret.trim()
    if (secret && secret.length < 16) {
      return NextResponse.json({ error: '密钥至少 16 个字符' }, { status: 400 })
    }
    if (/[\r\n]/.test(secret)) {
      return NextResponse.json({ error: '密钥不能包含换行' }, { status: 400 })
    }
    if (secret) setSetting('webhook_secret', secret)
    else deleteSetting('webhook_secret')
  }

  for (const k of AI_KEYS) {
    if (typeof body[k] === 'string') {
      const v = body[k].trim()
      if (v && /[\r\n]/.test(v)) {
        return NextResponse.json({ error: '配置项不能包含换行' }, { status: 400 })
      }
      if (v) setSetting(AI_SETTING_KEY[k], v)
      else deleteSetting(AI_SETTING_KEY[k])
    }
  }

  const ai = getAiConfig()
  return NextResponse.json({
    ok: true,
    webhook: webhookInfo(),
    ai: { baseUrl: ai.baseUrl, apiKey: ai.apiKey, model: ai.model, cliPath: ai.cliPath, source: ai.source },
  })
}

/** POST：webhook 随机生成密钥 / AI 连接测试（admin） */
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (user.role !== 'admin') return forbidden()

  const { action } = await req.json().catch(() => ({}))
  if (action === 'generate') {
    setSetting('webhook_secret', randomBytes(24).toString('hex'))
    return NextResponse.json({ ok: true, webhook: webhookInfo() })
  }
  if (action === 'test-ai') {
    if (!aiEnabled()) {
      return NextResponse.json({ ok: false, error: '未配置模型端点' }, { status: 400 })
    }
    const { testAiConnection } = await import('@/lib/ai/chat')
    const result = await testAiConnection()
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  }
  return NextResponse.json({ error: '未知操作' }, { status: 400 })
}
