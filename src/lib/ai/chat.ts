import { query } from '@anthropic-ai/claude-agent-sdk'
import path from 'node:path'
import { config } from '@/lib/core/config'
import { getSetting } from '@/lib/core/db'
import { searchDocs, type SearchResult } from '@/lib/search/search'

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
3. 若问题附带了【检索线索】，那是全文索引搜出的候选文档，优先 Read 它们确认是否切题，切题就基于其内容作答，必要时再用 Grep/Glob 扩大范围。
4. 引用来源时使用 markdown 链接：[文档标题](仓库相对路径.md)，例如 [部署指南](guide/deployment.md)。
5. 你只有只读工具：不要创建、修改或删除任何文件，不要执行写操作。
6. 用户可能用「它/这篇/那个」指代上文提到的文档，结合多轮上下文理解。
7. 工具调用轮次有限：相互独立的 Read/Grep/Glob 必须在同一轮里并行发起，不要一篇一篇串行读；精读不超过 5 篇，尽快给出最终回答。`

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

interface QueryOpts {
  sessionId?: string | null
  allowedTools: string[]
  maxTurns: number
  systemAppend: string
}

/** 底层流式查询：逐 token 增量（不支持时回退整段），块边界按工具调用判定 */
async function* runQuery(prompt: string, opts: QueryOpts, signal: AbortSignal): AsyncGenerator<ChatEvent> {
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
      prompt,
      options: {
        cwd: config.repoDir,
        allowedTools: opts.allowedTools,
        permissionMode: 'dontAsk', // 未经预批的工具一律拒绝——只读保障
        includePartialMessages: true, // 逐 token 流式（model/网关不支持时自动退化到整段）
        ...(opts.sessionId ? { resume: opts.sessionId } : {}),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: opts.systemAppend },
        maxTurns: opts.maxTurns,
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
    /* 块边界补段落分隔时做归一化：剥掉上文尾部与块首的换行后再补单个 \n\n——
     * 否则模型 narrate 文本自带行尾换行时与分隔叠加，流式期间空白行随工具调用
     * 次数越积越多（终渲染走 markdown 会被折叠，所以最终又"消失"） */
    const append = (text: string, newBlock: boolean): void => {
      if (newBlock && acc) {
        const body = text.replace(/^\n+/, '')
        acc = acc.replace(/\n+$/, '')
        if (body) acc += '\n\n' + body
      } else {
        acc += text
      }
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
        } else if (msg.subtype === 'error_max_turns') {
          yield {
            type: 'error',
            error: '检索步数达到上限仍未给出结论：请把问题问得更具体（指明文档名/关键词），或换个问法重试',
          }
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

/**
 * 检索增强：提问先过一遍 FTS5 全文索引，把候选文档作为线索注入 prompt，
 * 引导 agent 优先精读这几篇而不是从全库 Grep 开始摸索——省 token 且更快。
 * 自然语言提问含大量虚词，searchDocs 的多词 AND 语义对整句往往零命中；
 * 这里按词逐个搜索再按「命中词数 + 排名」聚合，与问答场景更匹配。
 * 搜索失败（索引未建等）不阻断对话，返回空串。
 */
export function retrievalHints(message: string): string {
  try {
    const terms = [
      ...new Set(
        message
          .split(/[\s，。？！、；：,.?!;:"'“”‘’（）()【】[\]<>《》…—-]+/)
          .filter((t) => [...t].length >= 2 && [...t].length <= 30),
      ),
    ].slice(0, 6)
    const scores = new Map<string, { hit: SearchResult; terms: number; rank: number }>()
    for (const t of terms) {
      for (const [i, hit] of searchDocs(t, 5).entries()) {
        const cur = scores.get(hit.path)
        if (cur) {
          cur.terms++
          cur.rank = Math.min(cur.rank, i)
        } else {
          scores.set(hit.path, { hit, terms: 1, rank: i })
        }
      }
    }
    const top = [...scores.values()].sort((a, b) => b.terms - a.terms || a.rank - b.rank).slice(0, 5)
    if (top.length === 0) return ''
    const lines = top.map(({ hit }) => {
      const snippet = hit.snippet.replace(/<\/?mark>/g, '').replace(/\s+/g, ' ').slice(0, 120)
      return `- ${hit.path}（${hit.title}）：${snippet}`
    })
    return `\n\n【检索线索】以下文档可能与问题相关（按相关度排序）：\n${lines.join('\n')}`
  } catch {
    return ''
  }
}

/**
 * 流式发起一轮对话。sessionId 为空时开新会话（init 事件里拿到新 id）。
 * signal 中止（客户端断连）时取消底层查询。
 */
export async function* streamChat(
  message: string,
  sessionId: string | null,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  yield* runQuery(
    message + retrievalHints(message),
    // maxTurns 要给足：第三方模型较少并行工具调用，串行 Read 几篇候选文档就会烧掉十几轮
    { sessionId, allowedTools: ['Read', 'Grep', 'Glob'], maxTurns: 48, systemAppend: SYSTEM_APPEND },
    signal,
  )
}

/* ---------------- 编辑器 AI 辅助：无工具纯文字变换 ---------------- */

export type AssistAction = 'polish' | 'continue' | 'translate' | 'title' | 'summary'

export const ASSIST_ACTIONS: Record<AssistAction, { label: string; prompt: (text: string) => string }> = {
  polish: {
    label: '润色',
    prompt: (t) => `把下面的 Markdown 文字润色得更通顺、专业，保持原意与 Markdown 格式，直接输出改写后的文字本身，不要任何解释：\n\n${t}`,
  },
  continue: {
    label: '续写',
    prompt: (t) => `接着下面的 Markdown 文字继续写，风格与上下文一致，直接输出续写内容本身，不要任何解释：\n\n${t}`,
  },
  translate: {
    label: '翻译',
    prompt: (t) => `把下面的 Markdown 文字翻译（中文→英文，英文→中文），保持 Markdown 格式，直接输出译文本身，不要任何解释：\n\n${t}`,
  },
  title: {
    label: '起标题',
    prompt: (t) => `给下面的 Markdown 文字起 5 个简洁贴切的标题候选，每行一个，直接输出，不要任何解释：\n\n${t}`,
  },
  summary: {
    label: '总结',
    prompt: (t) => `用不超过 3 句话总结下面的 Markdown 文字，直接输出总结本身，不要任何解释：\n\n${t}`,
  },
}

const ASSIST_APPEND = `你是文字变换工具：严格按用户指令处理给定文字，直接输出结果本身——不解释、不引用、不使用任何工具。`

/** 编辑器 AI 辅助：单轮、无工具、纯文字变换 */
export async function* streamAssist(action: AssistAction, text: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
  yield* runQuery(
    ASSIST_ACTIONS[action].prompt(text),
    { allowedTools: [], maxTurns: 2, systemAppend: ASSIST_APPEND },
    signal,
  )
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
