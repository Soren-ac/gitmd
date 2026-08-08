import { query } from '@anthropic-ai/claude-agent-sdk'
import path from 'node:path'
import { config } from '@/lib/core/config'
import { getSetting } from '@/lib/core/db'

/* ============================================================
 * AI 对话后端：Claude Code Agent SDK 驱动，模型端点可配。
 * CLI 子进程带 Read/Grep/Glob 只读工具，cwd 指向文档仓库，
 * 模型自己在文档库里检索阅读；多轮靠 session_id resume。
 * ============================================================ */

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
  cliPath: string
  /** 生效来源：界面配置（DB）/ 环境变量 / 未配置 */
  source: 'db' | 'env' | 'none'
}

/** 配置优先级：管理界面（settings 表）→ AI_* 环境变量 → ANTHROPIC_* 环境变量（部署机 CLI 现有配置） */
export function getAiConfig(): AiConfig {
  const dbUrl = getSetting('ai_base_url')
  const dbKey = getSetting('ai_api_key')
  const baseUrl = dbUrl ?? process.env.AI_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? ''
  const apiKey =
    dbKey ?? process.env.AI_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? ''
  return {
    baseUrl,
    apiKey,
    model: getSetting('ai_model') ?? process.env.AI_MODEL ?? process.env.ANTHROPIC_MODEL ?? '',
    cliPath: getSetting('ai_cli_path') ?? process.env.AI_CLI_PATH ?? '',
    source: dbUrl || dbKey ? 'db' : baseUrl || apiKey ? 'env' : 'none',
  }
}

export function aiEnabled(): boolean {
  const c = getAiConfig()
  return Boolean(c.baseUrl && c.apiKey)
}

const SYSTEM_APPEND = `你是 GitMD 文档平台内置的文档助手。当前工作目录就是团队的文档仓库（Markdown 文件）。
规则：
1. 用中文回答，简洁、准确、有条理。
2. 回答前先用 Glob/Grep/Read 在仓库中检索并阅读相关文档；答案必须基于文档内容。找不到相关内容时明确说「文档中暂无相关内容」，不要编造。
3. 引用来源时使用 markdown 链接：[文档标题](仓库相对路径.md)，例如 [部署指南](guide/deployment.md)。
4. 你只有只读工具：不要创建、修改或删除任何文件，不要执行写操作。
5. 用户可能用「它/这篇/那个」指代上文提到的文档，结合多轮上下文理解。`

export type ChatEvent =
  | { type: 'delta'; text: string; newBlock?: boolean }
  | { type: 'activity'; text: string }
  | { type: 'session'; sessionId: string }
  | { type: 'done'; fullText: string }
  | { type: 'error'; error: string }

/** 把工具调用翻译成用户可读的进度提示 */
function describeTool(name: string, input: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>
  const rel = typeof inp.file_path === 'string' ? path.relative(config.repoDir, inp.file_path) : ''
  switch (name) {
    case 'Read':
      return rel ? `正在阅读 ${rel}` : '正在阅读文档'
    case 'Grep':
      return typeof inp.pattern === 'string' ? `正在搜索「${inp.pattern}」` : '正在搜索文档'
    case 'Glob':
      return typeof inp.pattern === 'string' ? `正在查找 ${inp.pattern}` : '正在查找文档'
    default:
      return `正在使用工具 ${name}`
  }
}

const QUERY_TIMEOUT_MS = 180_000

/**
 * 流式发起一轮对话。sessionId 为空时开新会话（init 事件里拿到新 id）。
 * signal 中止（客户端断连）时取消底层查询。
 */
export async function* streamChat(
  message: string,
  sessionId: string | null,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const ai = getAiConfig()

  // SDK 的 env 是整体替换子进程环境，必须展开 process.env 再覆盖 Anthropic 端点
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  env.ANTHROPIC_BASE_URL = ai.baseUrl
  env.ANTHROPIC_AUTH_TOKEN = ai.apiKey
  env.ANTHROPIC_API_KEY = ai.apiKey
  if (ai.model) env.ANTHROPIC_MODEL = ai.model

  const abort = new AbortController()
  const onOuterAbort = () => abort.abort()
  signal.addEventListener('abort', onOuterAbort)
  const timer = setTimeout(() => abort.abort(), QUERY_TIMEOUT_MS)

  let finished = false
  try {
    const q = query({
      prompt: message,
      options: {
        cwd: config.repoDir,
        allowedTools: ['Read', 'Grep', 'Glob'],
        permissionMode: 'dontAsk', // 未经预批的工具一律拒绝——只读保障
        includePartialMessages: true, // 逐 token 流式（model/网关不支持时自动退化到整段）
        ...(sessionId ? { resume: sessionId } : {}),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
        maxTurns: 10,
        abortController: abort,
        env,
        ...(ai.cliPath ? { pathToClaudeCodeExecutable: ai.cliPath } : {}),
      },
    })

    // 优先消费 stream_event 的逐 token 增量；完整 assistant 消息只用于工具活动与全文汇总。
    // 若模型端点不支持流式（收不到增量），回退为整段转发。
    // 块边界判定：只有「上一文本块之后发生了工具调用」才是真边界（补段落分隔）；
    // 某些网关会把响应切成大量小消息/小事件，块间不能加分隔，否则会竖排碎裂。
    let sawPartial = false
    let toolSinceLastText = false
    let pendingNew = false
    let acc = ''
    const append = (text: string, newBlock: boolean): string => {
      acc += (newBlock && acc ? '\n\n' : '') + text
      return text
    }

    for await (const msg of q) {
      if (msg.type === 'stream_event') {
        const ev = msg.event
        if (ev.type === 'content_block_start') {
          const bt = ev.content_block?.type
          if (bt === 'tool_use') toolSinceLastText = true
          else if (bt === 'text') pendingNew = toolSinceLastText
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          const text = ev.delta.text
          if (text) {
            sawPartial = true
            append(text, pendingNew)
            yield { type: 'delta', text, newBlock: pendingNew }
            pendingNew = false
            toolSinceLastText = false
          }
        }
        continue
      }
      if (msg.type === 'system' && msg.subtype === 'init') {
        yield { type: 'session', sessionId: msg.session_id }
        continue
      }
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text.trim()) {
            // 有增量流时完整消息与增量重复，只在没有增量（回退路径）时采用
            if (!sawPartial) {
              append(block.text, toolSinceLastText)
              yield { type: 'delta', text: block.text, newBlock: toolSinceLastText }
            }
            toolSinceLastText = false
          } else if (block.type === 'tool_use') {
            toolSinceLastText = true
            yield { type: 'activity', text: describeTool(block.name, (block as { input?: unknown }).input) }
          }
        }
        continue
      }
      if (msg.type === 'result') {
        finished = true
        if (msg.subtype === 'success') {
          yield { type: 'done', fullText: acc }
        } else {
          yield { type: 'error', error: `模型调用未成功（${msg.subtype}）` }
        }
      }
    }
    // 流自然结束但没收到 result：兜底收尾
    if (!finished && acc) yield { type: 'done', fullText: acc }
  } catch (err) {
    if (signal.aborted) return // 客户端走了，无需再产出事件
    const msg = abort.signal.aborted ? '响应超时，请重试' : err instanceof Error ? err.message : String(err)
    yield { type: 'error', error: msg }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onOuterAbort)
  }
}

/** 管理界面「测试连接」：最小化真实调用验证端点/密钥/CLI 可用 */
export async function testAiConnection(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const ai = getAiConfig()
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v
  env.ANTHROPIC_BASE_URL = ai.baseUrl
  env.ANTHROPIC_AUTH_TOKEN = ai.apiKey
  env.ANTHROPIC_API_KEY = ai.apiKey
  if (ai.model) env.ANTHROPIC_MODEL = ai.model

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 45_000)
  const started = Date.now()
  try {
    const q = query({
      prompt: '回复 ok 两个字母即可',
      options: {
        cwd: config.repoDir,
        allowedTools: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        abortController: abort,
        env,
        ...(ai.cliPath ? { pathToClaudeCodeExecutable: ai.cliPath } : {}),
      },
    })
    for await (const msg of q) {
      if (msg.type === 'result') {
        if (msg.subtype === 'success') return { ok: true, latencyMs: Date.now() - started }
        return { ok: false, error: `调用未成功（${msg.subtype}）` }
      }
    }
    return { ok: false, error: '未收到结果' }
  } catch (err) {
    const msg = abort.signal.aborted ? '连接超时（45s）' : err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}
