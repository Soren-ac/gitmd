import { createHash } from 'node:crypto'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkFrontmatter from 'remark-frontmatter'
import type { Root as MdastRoot, RootContent, Definition } from 'mdast'
// 用 undici 自带 fetch：避开 Next 对全局 fetch 的包装（二进制下载不需要其缓存语义）。
// 代理由启动钩子安装的 EnvHttpProxyAgent 全局调度器统一处理（见 lib/core/boot.ts）。
import { fetch as undiciFetch } from 'undici'

/* ============================================================
 * 外链图片转存：把 Markdown 中的 http(s) 图片下载到仓库 assets/，
 * 并把源码中的 URL 重写为仓库根相对路径（/assets/<内容哈希>.<ext>）。
 * 与上传通道一致：渲染层 rehypeRewriteLinks 会把 /assets/* 重写为
 * /api/assets/*，无需改动渲染管线。
 * ============================================================ */

const MAX_BYTES = 10 * 1024 * 1024 // 与上传限制一致
const FETCH_TIMEOUT_MS = 15000
const CONCURRENCY = 4

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/avif': '.avif',
}

/** 外链判定与渲染管线 rehypeRewriteLinks 保持一致：http(s):// 与协议相对 // */
function isExternalUrl(url: string): boolean {
  return /^(https?:)?\/\//i.test(url)
}

export interface LocalizedFile {
  rel: string // 仓库相对路径，如 assets/ext-<hash>.png
  buf: Buffer
}

export interface LocalizeResult {
  content: string // 重写后的 Markdown（无外链或全部失败时与入参相同）
  files: LocalizedFile[] // 待写入仓库的图片文件（调用方负责在写队列内落盘）
  localized: { from: string; to: string }[] // 成功转存：原始 URL → 新路径
  failed: { url: string; reason: string }[] // 下载失败：保留原链接
}

/** 一处需要替换的源码片段；build(newUrl) 生成替换文本 */
interface Ref {
  start: number
  end: number
  url: string
  build: (newUrl: string) => string
}

/** 在 ![ 之后按括号配平找闭合 ]（处理转义与嵌套方括号），返回其下标 */
function findAltClose(slice: string): number {
  let depth = 1
  for (let i = 2; i < slice.length; i++) {
    const ch = slice[i]
    if (ch === '\\') i++
    else if (ch === '[') depth++
    else if (ch === ']' && --depth === 0) return i
  }
  return -1
}

function quoteTitle(title: string): string {
  return `"${title.replace(/(["\\])/g, '\\$1')}"`
}

/** 从 mdast 收集外链图片引用：行内图片、HTML <img>、引用式图片的 definition */
function collectRefs(source: string): Ref[] {
  const tree = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(source) as MdastRoot
  const refs: Ref[] = []
  const refIds = new Set<string>() // 被 imageReference 使用的 definition 标识

  const walk = (node: MdastRoot | RootContent) => {
    const children = (node as { children?: RootContent[] }).children
    if (children) for (const c of children) walk(c)

    if (node.type === 'imageReference') {
      const id = (node as { identifier?: string }).identifier
      if (id) refIds.add(id.toLowerCase())
      return
    }

    const pos = node.position
    const start = pos?.start.offset
    const end = pos?.end.offset
    if (start == null || end == null || end <= start) return

    if (node.type === 'image') {
      const { url, title } = node as { url: string; title?: string | null }
      if (!isExternalUrl(url)) return
      const slice = source.slice(start, end)
      if (!slice.startsWith('![')) return
      const close = findAltClose(slice)
      if (close < 0) return
      const rawAlt = slice.slice(2, close) // 原样保留 alt 中的格式符号
      refs.push({
        start,
        end,
        url,
        build: (newUrl) => `![${rawAlt}](${newUrl}${title ? ` ${quoteTitle(title)}` : ''})`,
      })
      return
    }

    if (node.type === 'html') {
      const raw = source.slice(start, end)
      // 一个 html 节点可能含多个 <img>；逐个替换 src 属性值
      const re = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(https?:\/\/[^"']+|\/\/[^"']+)\2/gi
      let m: RegExpExecArray | null
      while ((m = re.exec(raw))) {
        const urlStart = start + m.index + m[1].length + 1
        refs.push({
          start: urlStart,
          end: urlStart + m[3].length,
          url: m[3],
          build: (newUrl) => newUrl,
        })
      }
      return
    }

    if (node.type === 'definition') {
      const def = node as Definition
      if (!refIds.has(def.identifier.toLowerCase())) return // 链接引用，不是图片
      if (!isExternalUrl(def.url)) return
      const slice = source.slice(start, end)
      // 形如 [label]: <url> "title"；前缀正则在转义方括号等罕见情形下失配时放弃该处
      const m = slice.match(/^(\s*\[[^\]]*\]:\s*)/)
      if (!m) return
      const prefix = m[1]
      const title = def.title
      refs.push({
        start,
        end,
        url: def.url,
        build: (newUrl) => `${prefix}${newUrl}${title ? ` ${quoteTitle(title)}` : ''}`,
      })
    }
  }
  walk(tree)
  return refs
}

/** content-type 不可信时用魔数嗅探图片类型 */
function sniffExt(buf: Buffer): string | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return '.png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return '.gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return '.webp'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return '.bmp'
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return '.ico'
  if (buf.subarray(0, 256).toString('latin1').includes('<svg')) return '.svg'
  return null
}

class DownloadError extends Error {}

async function downloadImage(url: string): Promise<{ buf: Buffer; ext: string }> {
  const fetchUrl = url.startsWith('//') ? `https:${url}` : url
  let res
  try {
    res = await undiciFetch(fetchUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
      // 部分图床按 UA 拦截非浏览器请求
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; gitmd-image-localizer)' },
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new DownloadError(timedOut ? '下载超时' : '网络不可达')
  }
  if (!res.ok) throw new DownloadError(`HTTP ${res.status}`)

  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) throw new DownloadError('图片超过 10MB')

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new DownloadError('图片超过 10MB')
  if (buf.length === 0) throw new DownloadError('空文件')

  // content-type 优先；部分服务器不回传正确 content-type，降级为魔数嗅探
  let ext: string | undefined = EXT_BY_MIME[mime]
  if (!ext && (mime === '' || mime === 'application/octet-stream' || mime === 'binary/octet-stream')) {
    ext = sniffExt(buf) ?? undefined
  }
  if (!ext) {
    throw new DownloadError(mime.startsWith('image/') ? `暂不支持的图片类型 ${mime}` : `非图片内容（${mime || '未知类型'}）`)
  }
  return { buf, ext }
}

/** 简单并发池 */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const cur = i++
        out[cur] = await fn(items[cur])
      }
    }),
  )
  return out
}

/**
 * 转存 Markdown 中的外链图片。纯计算 + 网络下载，不触碰文件系统与 git——
 * 调用方把 files 与改写后的文档放在同一个 withWriteOp 中提交，保证单次 commit 原子性。
 */
export async function localizeExternalImages(source: string): Promise<LocalizeResult> {
  const noop: LocalizeResult = { content: source, files: [], localized: [], failed: [] }
  if (!source.includes('//')) return noop

  let refs: Ref[]
  try {
    refs = collectRefs(source)
  } catch {
    return noop // 解析失败不阻断保存
  }
  if (refs.length === 0) return noop

  // 按 URL 去重下载；相同内容哈希同名，天然跨文档去重
  const urls = [...new Set(refs.map((r) => r.url))]
  const results = await mapPool(urls, CONCURRENCY, async (url) => {
    try {
      const { buf, ext } = await downloadImage(url)
      const name = `assets/ext-${createHash('sha256').update(buf).digest('hex').slice(0, 16)}${ext}`
      return { url, ok: true as const, file: { rel: name, buf }, to: `/${name}` }
    } catch (err) {
      return { url, ok: false as const, reason: err instanceof Error ? err.message : '下载失败' }
    }
  })

  const byUrl = new Map(results.map((r) => [r.url, r]))
  const files: LocalizedFile[] = []
  const seenFiles = new Set<string>()
  const localized: { from: string; to: string }[] = []
  const failed: { url: string; reason: string }[] = []
  const replacements: { start: number; end: number; text: string }[] = []

  for (const ref of refs) {
    const r = byUrl.get(ref.url)
    if (!r) continue
    if (r.ok) {
      replacements.push({ start: ref.start, end: ref.end, text: ref.build(r.to) })
      if (!seenFiles.has(r.file.rel)) {
        seenFiles.add(r.file.rel)
        files.push(r.file)
        localized.push({ from: ref.url, to: r.to })
      }
    } else if (!failed.some((f) => f.url === ref.url)) {
      failed.push({ url: ref.url, reason: r.reason })
    }
  }

  // 从后往前替换，偏移互不影响
  replacements.sort((a, b) => b.start - a.start)
  let content = source
  for (const rep of replacements) {
    content = content.slice(0, rep.start) + rep.text + content.slice(rep.end)
  }
  return { content, files, localized, failed }
}
