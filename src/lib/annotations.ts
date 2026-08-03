import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { config } from './config'
import { git, withGitLock } from './git'
import { splitFrontmatter } from './frontmatter'

/** 锚点偏移一律基于正文（去掉 frontmatter），与渲染节点 data-source-* 坐标系一致 */
function bodyOf(text: string): string {
  return splitFrontmatter(text).body
}

/**
 * 批注锚点：源码位置 + 文本上下文 + Git 版本 + AST（所在标题）的组合。
 * - quote/prefix/suffix：精确匹配与模糊重定位的主锚点
 * - start/end：批注创建时（base 版本）的源码偏移，快速路径
 * - base：创建时的 commit SHA，用于 diff 平移和查看原始版本
 * - section：所在最近标题文本，AST 辅助锚点（重名 quote 时投票）
 */
export interface Anchor {
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
  base: string
  section: string
}

export interface AnnotationComment {
  author: string
  body: string
  at: string
}

export interface Annotation {
  id: string
  doc: string
  anchor: Anchor
  author: string
  created_at: string
  resolved: boolean
  comments: AnnotationComment[]
}

export type LocateStatus = 'exact' | 'relocated' | 'orphaned'

export interface LocatedAnnotation extends Annotation {
  status: LocateStatus
  located: { start: number; end: number } | null
}

const CONTEXT_LEN = 40

function sidecarPath(docRel: string): string | null {
  const abs = path.normalize(path.join(config.repoDir, '.gitmd', 'annotations', `${docRel}.yaml`))
  if (!abs.startsWith(config.repoDir + path.sep)) return null
  return abs
}

export function readAnnotations(docRel: string): Annotation[] {
  const abs = sidecarPath(docRel)
  if (!abs || !fs.existsSync(abs)) return []
  try {
    const data = parseYaml(fs.readFileSync(abs, 'utf8'))
    return Array.isArray(data) ? (data as Annotation[]) : []
  } catch {
    return []
  }
}

function writeAnnotationsFile(docRel: string, list: Annotation[]) {
  const abs = sidecarPath(docRel)
  if (!abs) throw new Error('非法文档路径')
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, stringifyYaml(list), 'utf8')
}

export function makeAnnotation(
  docRel: string,
  anchor: Anchor,
  author: string,
  body: string,
): Annotation {
  return {
    id: randomUUID().slice(0, 8),
    doc: docRel,
    anchor,
    author,
    created_at: new Date().toISOString(),
    resolved: false,
    comments: [{ author, body, at: new Date().toISOString() }],
  }
}

export function saveNew(docRel: string, annotation: Annotation) {
  const list = readAnnotations(docRel)
  list.push(annotation)
  writeAnnotationsFile(docRel, list)
}

export function updateAnnotation(docRel: string, id: string, fn: (a: Annotation) => void): boolean {
  const list = readAnnotations(docRel)
  const target = list.find((a) => a.id === id)
  if (!target) return false
  fn(target)
  writeAnnotationsFile(docRel, list)
  return true
}

export function deleteAnnotation(docRel: string, id: string): boolean {
  const list = readAnnotations(docRel)
  const next = list.filter((a) => a.id !== id)
  if (next.length === list.length) return false
  writeAnnotationsFile(docRel, next)
  return true
}

/* ---------------- 创建时定位：把渲染态选区文本钉回源码偏移 ---------------- */

export function locateForCreate(
  content: string,
  quote: string,
  estStart: number,
  estEnd: number,
): { start: number; end: number; prefix: string; suffix: string } | null {
  let s = -1
  // 优先在估计位置附近找
  const winStart = Math.max(0, estStart - 800)
  const winEnd = Math.min(content.length, Math.max(estEnd + 800, estStart + 1600))
  const win = content.slice(winStart, winEnd)
  let best = -1
  let bestDist = Infinity
  let idx = win.indexOf(quote)
  while (idx !== -1) {
    const abs = winStart + idx
    const dist = Math.abs(abs - estStart)
    if (dist < bestDist) {
      bestDist = dist
      best = abs
    }
    idx = win.indexOf(quote, idx + 1)
  }
  if (best >= 0) s = best
  if (s < 0) s = content.indexOf(quote)
  if (s < 0) return null
  const e = s + quote.length
  return {
    start: s,
    end: e,
    prefix: content.slice(Math.max(0, s - CONTEXT_LEN), s),
    suffix: content.slice(e, e + CONTEXT_LEN),
  }
}

/* ---------------- 重定位：exact → git diff 平移 → 模糊匹配 → orphaned ---------------- */

function lineStartOffsets(text: string): number[] {
  const offsets = [0]
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') offsets.push(i + 1)
  }
  return offsets
}

function lineOf(offsets: number[], offset: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** 用 git diff -U0 的 hunk 把 base 版本的偏移平移到当前版本；锚点所在行被修改时返回 null */
async function translateViaDiff(
  docRel: string,
  base: string,
  start: number,
  end: number,
): Promise<{ start: number; end: number } | null> {
  if (!/^[0-9a-f]{7,40}$/i.test(base)) return null
  const [baseContentRaw, diffOut] = await withGitLock(async () => {
    const content = await git.raw(['show', `${base}:${docRel}`]).catch(() => null)
    const diff = await git.raw(['diff', `${base}..HEAD`, '-U0', '--', docRel]).catch(() => null)
    return [content, diff] as const
  })
  if (baseContentRaw == null || diffOut == null) return null
  const baseContent = bodyOf(baseContentRaw)

  const baseLines = lineStartOffsets(baseContent)
  const currentLines = lineStartOffsets(readFileText(docRel))
  const startLine = lineOf(baseLines, start)
  const endLine = lineOf(baseLines, end)
  const startCol = start - baseLines[startLine]
  const endCol = end - baseLines[endLine]

  // 逐 hunk 平移行号；命中被修改的行区间则无法精确平移
  let delta = 0
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm
  let m: RegExpExecArray | null
  let newStartLine = -1
  let newEndLine = -1
  const seen = new Set<number>()
  while ((m = hunkRe.exec(diffOut))) {
    const oldStart = Number(m[1]) - 1 // 转 0 基
    const oldCount = m[2] ? Number(m[2]) : 1
    const newCount = m[4] ? Number(m[4]) : 1
    const oldEnd = oldStart + Math.max(oldCount, 1)
    // start/end 落在被改动的行内 → 文本已变，交给模糊匹配
    if (startLine >= oldStart && startLine < oldEnd) return null
    if (endLine >= oldStart && endLine < oldEnd) return null
    if (oldEnd <= startLine && !seen.has(oldStart)) {
      delta += newCount - oldCount
      seen.add(oldStart)
    }
  }
  newStartLine = startLine + delta
  newEndLine = endLine + delta
  if (newStartLine < 0 || newEndLine >= currentLines.length || newEndLine < newStartLine) return null
  const s = currentLines[newStartLine] + startCol
  const e = currentLines[newEndLine] + endCol
  if (s < 0 || e > (currentLines[currentLines.length - 1] ?? 0) + 1e7) return null
  return { start: s, end: e }
}

function readFileText(docRel: string): string {
  try {
    return bodyOf(fs.readFileSync(path.join(config.repoDir, docRel), 'utf8'))
  } catch {
    return ''
  }
}

/** 模糊匹配：quote 出现位置按前后文相似度 + 距原位置距离打分 */
function fuzzyLocate(
  content: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  let idx = content.indexOf(anchor.quote)
  let best: { start: number; end: number; score: number } | null = null
  while (idx !== -1) {
    const e = idx + anchor.quote.length
    const pre = content.slice(Math.max(0, idx - CONTEXT_LEN), idx)
    const suf = content.slice(e, e + CONTEXT_LEN)
    let score = 0
    if (anchor.prefix && pre.endsWith(anchor.prefix.slice(-12))) score += 2
    else if (anchor.prefix && pre.endsWith(anchor.prefix.slice(-6))) score += 1
    if (anchor.suffix && suf.startsWith(anchor.suffix.slice(0, 12))) score += 2
    else if (anchor.suffix && suf.startsWith(anchor.suffix.slice(0, 6))) score += 1
    score -= Math.min(Math.abs(idx - anchor.start) / 4000, 2)
    if (!best || score > best.score) best = { start: idx, end: e, score }
    idx = content.indexOf(anchor.quote, idx + 1)
  }
  return best && best.score >= 1 ? { start: best.start, end: best.end } : null
}

/** 对一批批注做重定位（当前工作区内容为准） */
export async function locateAnnotations(docRel: string): Promise<LocatedAnnotation[]> {
  const content = readFileText(docRel)
  const list = readAnnotations(docRel)
  const out: LocatedAnnotation[] = []
  for (const a of list) {
    let located: { start: number; end: number } | null = null
    let status: LocateStatus = 'orphaned'
    if (content.slice(a.anchor.start, a.anchor.end) === a.anchor.quote) {
      located = { start: a.anchor.start, end: a.anchor.end }
      status = 'exact'
    } else {
      const translated = await translateViaDiff(docRel, a.anchor.base, a.anchor.start, a.anchor.end)
      if (translated && content.slice(translated.start, translated.end) === a.anchor.quote) {
        located = translated
        status = 'relocated'
      } else {
        const fuzzy = fuzzyLocate(content, a.anchor)
        if (fuzzy) {
          located = fuzzy
          status = 'relocated'
        }
      }
    }
    out.push({ ...a, status, located })
  }
  return out
}
