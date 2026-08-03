import { unified, type Plugin } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { createElement, type ReactNode } from 'react'
import { createHash } from 'node:crypto'
import path from 'node:path'
import Mermaid from '@/components/Mermaid'
import CopyBtn from '@/components/CopyBtn'
import DocImage from '@/components/DocImage'
import type { Root, Element, RootContent } from 'hast'
import type { Root as MdastRoot } from 'mdast'

export interface TocItem {
  id: string
  text: string
  depth: 2 | 3
}

interface Ctx {
  docDir: string // 文档所在目录（仓库相对，posix）
  mode: 'rsc' | 'html'
  toc?: TocItem[]
  usedSlugs?: Set<string>
  stripFirstH1?: boolean
  baseOffset?: number // 分块渲染时块在全文中的起始偏移，用于校正 data-source-*
}

function walk(node: Root | Element, fn: (n: RootContent, parent: Root | Element) => void) {
  const children = (node as Element).children
  if (!children) return
  for (const child of children) {
    fn(child, node)
    if ((child as Element).children) walk(child as Element, fn)
  }
}

function textOf(node: Element | RootContent): string {
  if (node.type === 'text') return node.value
  const children = (node as Element).children
  return children ? children.map(textOf).join('') : ''
}

function slugify(text: string, used: Set<string>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '')
  let slug = base || 'section'
  let i = 1
  while (used.has(slug)) slug = `${base}-${++i}`
  used.add(slug)
  return slug
}

/** 标题加锚点 id，收集 h2/h3 生成目录；可选移除正文首个 h1（文档头部已展示标题） */
const rehypeHeadings: Plugin<[Ctx], Root> = (ctx) => (tree) => {
  let h1Stripped = false
  walk(tree, (node, parent) => {
    if (node.type !== 'element') return
    if (ctx.stripFirstH1 && !h1Stripped && node.tagName === 'h1') {
      const idx = parent.children.indexOf(node)
      if (idx >= 0) parent.children.splice(idx, 1)
      h1Stripped = true
      return
    }
    if (node.tagName === 'h2' || node.tagName === 'h3') {
      const text = textOf(node)
      const id = slugify(text, ctx.usedSlugs ?? new Set())
      node.properties = { ...node.properties, id }
      ctx.toc?.push({ id, text, depth: node.tagName === 'h2' ? 2 : 3 })
    }
  })
}

/** mermaid 代码块 → 画布节点（RSC 模式 → 客户端组件；HTML 模式 → data 标记） */
const rehypeMermaid: Plugin<[Ctx], Root> = (ctx) => (tree) => {
  walk(tree, (node, parent) => {
    if (node.type !== 'element' || node.tagName !== 'pre') return
    const code = node.children[0]
    if (!code || code.type !== 'element' || code.tagName !== 'code') return
    const cls = (code.properties?.className as string[] | undefined) ?? []
    if (!cls.includes('language-mermaid')) return
    const chart = textOf(code)
    const replacement: Element =
      ctx.mode === 'rsc'
        ? { type: 'element', tagName: 'mermaid-block', properties: { chart }, children: [] }
        : {
            type: 'element',
            tagName: 'pre',
            properties: { 'data-mermaid': 'true' },
            children: [{ type: 'text', value: chart }],
          }
    const idx = parent.children.indexOf(node)
    if (idx >= 0) parent.children[idx] = replacement as RootContent
  })
}

/** 代码块 → 带语言标识与复制按钮的 IDE 式面板 */
const rehypeCodeBlock: Plugin<[Ctx], Root> = (ctx) => (tree) => {
  walk(tree, (node, parent) => {
    if (node.type !== 'element' || node.tagName !== 'pre') return
    const code = node.children[0]
    if (!code || code.type !== 'element' || code.tagName !== 'code') return
    const cls = (code.properties?.className as string[] | undefined) ?? []
    const lang = (cls.find((c) => c.startsWith('language-')) ?? '').replace('language-', '') || 'text'

    const copyEl: Element =
      ctx.mode === 'rsc'
        ? { type: 'element', tagName: 'copy-btn', properties: {}, children: [] }
        : {
            type: 'element',
            tagName: 'button',
            properties: { className: ['copy-btn'], type: 'button' },
            children: [{ type: 'text', value: '复制' }],
          }

    const figure: Element = {
      type: 'element',
      tagName: 'figure',
      properties: { className: ['code-block'], 'data-lang': lang },
      children: [
        {
          type: 'element',
          tagName: 'figcaption',
          properties: { className: ['code-head'] },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['code-lang'] },
              children: [{ type: 'text', value: lang }],
            },
            copyEl,
          ],
        },
        node,
      ],
    }
    const idx = parent.children.indexOf(node)
    if (idx >= 0) parent.children[idx] = figure as RootContent
  })
}

/** 表格 → 圆角滚动容器包裹 */
const rehypeTableWrap: Plugin<[], Root> = () => (tree) => {
  walk(tree, (node, parent) => {
    if (node.type !== 'element' || node.tagName !== 'table') return
    // 已被包裹过的跳过
    if (parent.type === 'element' && (parent.properties?.className as string[])?.includes('table-wrap')) return
    const wrap: Element = {
      type: 'element',
      tagName: 'div',
      properties: { className: ['table-wrap'] },
      children: [node],
    }
    const idx = parent.children.indexOf(node)
    if (idx >= 0) parent.children[idx] = wrap as RootContent
  })
}

const CALLOUT_TYPES: Record<string, string> = {
  note: '说明',
  tip: '提示',
  warning: '警告',
  important: '重要',
  danger: '危险',
}

/** GFM 风格 callout：> [!NOTE] → 语义化提示面板 */
const rehypeCallouts: Plugin<[], Root> = () => (tree) => {
  walk(tree, (node, parent) => {
    if (node.type !== 'element' || node.tagName !== 'blockquote') return
    const firstP = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'p')
    const firstText = firstP?.children[0]
    if (!firstText || firstText.type !== 'text') return
    const m = firstText.value.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|DANGER)\]\s*/i)
    if (!m) return
    const type = m[1].toLowerCase()
    // 去掉标记文本
    firstText.value = firstText.value.slice(m[0].length)
    if (!firstText.value && firstP) {
      node.children.splice(node.children.indexOf(firstP), 1)
    }

    const aside: Element = {
      type: 'element',
      tagName: 'aside',
      properties: { className: ['callout', `callout-${type}`] },
      children: [
        {
          type: 'element',
          tagName: 'p',
          properties: { className: ['callout-title'] },
          children: [
            { type: 'element', tagName: 'span', properties: { className: ['callout-icon'] }, children: [] },
            { type: 'text', value: CALLOUT_TYPES[type] ?? '提示' },
          ],
        },
        ...node.children,
      ],
    }
    const idx = parent.children.indexOf(node)
    if (idx >= 0) parent.children[idx] = aside as RootContent
  })
}

/** 把 AST 源码位置落到 DOM：批注系统据此把选区映射回源码偏移 */
const rehypeSourcePos: Plugin<[Ctx], Root> = (ctx) => (tree) => {
  const base = ctx.baseOffset ?? 0
  walk(tree, (node) => {
    if (node.type !== 'element' || !node.position) return
    const s = node.position.start.offset
    const e = node.position.end.offset
    if (s == null || e == null) return
    node.properties = {
      ...node.properties,
      'data-source-start': base + s,
      'data-source-end': base + e,
    }
  })
}

/** 相对路径的 img/src 与 a/href 重写：图片走 /api/assets，md 互链走 /docs；RSC 模式图片换成懒加载组件 */
const rehypeRewriteLinks: Plugin<[Ctx], Root> = (ctx) => (tree) => {
  const resolveRel = (src: string) => {
    const decoded = decodeURIComponent(src)
    const joined = decoded.startsWith('/')
      ? decoded.slice(1)
      : path.posix.normalize(path.posix.join(ctx.docDir, decoded))
    return joined.split('/').map(encodeURIComponent).join('/')
  }
  walk(tree, (node, parent) => {
    if (node.type !== 'element') return
    if (node.tagName === 'img' && typeof node.properties?.src === 'string') {
      const src = node.properties.src
      const alt = typeof node.properties.alt === 'string' ? node.properties.alt : ''
      if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return
      const resolved = '/api/assets/' + resolveRel(src)
      if (ctx.mode === 'rsc') {
        const imgEl: Element = {
          type: 'element',
          tagName: 'doc-img',
          properties: { src: resolved, alt },
          children: [],
        }
        const idx = parent.children.indexOf(node)
        if (idx >= 0) parent.children[idx] = imgEl as RootContent
      } else {
        node.properties.src = resolved
      }
    }
    if (node.tagName === 'a' && typeof node.properties?.href === 'string') {
      const href = node.properties.href
      if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return
      if (/\.mdx?(#.*)?$/i.test(href)) {
        const [p, hash] = href.split('#')
        const resolved = resolveRel(p).replace(/\.mdx?$/i, '')
        node.properties.href = '/docs/' + resolved + (hash ? `#${hash}` : '')
      }
    }
  })
}

function buildProcessor(ctx: Ctx) {
  const base = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeMermaid, ctx)
    .use(rehypeCallouts)
    .use(rehypeCodeBlock, ctx)
    .use(rehypeTableWrap)
    .use(rehypeHeadings, ctx)
    .use(rehypeRewriteLinks, ctx)
    .use(rehypeKatex)
    .use(rehypeSourcePos, ctx)
  if (ctx.mode === 'html') {
    return base.use(rehypeHighlight, { detect: false }).use(rehypeStringify)
  }
  return base.use(rehypeHighlight, { detect: false })
}

/* ---------------- 渲染缓存 ----------------
 * 键：内容哈希（含 docDir 与 stripFirstH1，相对链接解析依赖它们）。
 * 值：处理后的 HAST 与目录。HAST 是可复用的纯数据，
 * 每次请求只需做 toJsxRuntime（毫秒级）。
 * LRU：Map 按插入序淘汰，上限 200 篇。
 */
interface CacheEntry {
  hast: Root
  toc: TocItem[]
}
const renderCache = new Map<string, CacheEntry>()
const htmlCache = new Map<string, string>()
const CACHE_MAX = 200

function cacheKey(source: string, docDir: string, stripFirstH1: boolean, baseOffset = 0): string {
  return createHash('sha256')
    .update(stripFirstH1 ? '1' : '0')
    .update(String(baseOffset))
    .update(docDir)
    .update('\n')
    .update(source)
    .digest('hex')
}

function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit) // LRU：移到末尾
  }
  return hit
}

function lruSet<V>(cache: Map<string, V>, key: string, value: V) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, value)
}

/** 渲染为 HTML 字符串（编辑器实时预览使用）；按内容哈希缓存 */
export async function renderMarkdownHtml(source: string, docDir: string): Promise<string> {
  const key = cacheKey(source, docDir, false)
  const hit = lruGet(htmlCache, key)
  if (hit) return hit
  const processor = buildProcessor({ docDir, mode: 'html', usedSlugs: new Set() })
  const file = await processor.process(source)
  const html = String(file)
  lruSet(htmlCache, key, html)
  return html
}

/* ============================================================
 * 分块流式渲染：大文档按顶层块边界切分，首块同步渲染，
 * 其余块在 <Suspense> 中异步流入，页面可以秒开。
 * ============================================================ */

const CHUNK_MAX_CHARS = 12000

function mdastTextOf(node: MdastRoot['children'][number]): string {
  const anyNode = node as { value?: string; children?: MdastRoot['children'] }
  if (typeof anyNode.value === 'string') return anyNode.value
  return anyNode.children ? anyNode.children.map(mdastTextOf).join('') : ''
}

function parseMdast(source: string): MdastRoot {
  return unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).parse(source) as MdastRoot
}

/* 渲染计划（切块 + 目录）缓存：一次 mdast 解析同时产出两者 */
interface RenderPlan {
  chunks: string[]
  toc: TocItem[]
}
const planCache = new Map<string, RenderPlan>()

/** 大文档按顶层块边界切分 + 提取目录；一次解析，结果按内容哈希缓存 */
export function getRenderPlan(source: string): RenderPlan {
  const key = createHash('sha256').update(source).digest('hex')
  const hit = lruGet(planCache, key)
  if (hit) return hit

  const tree = parseMdast(source)
  const toc: TocItem[] = []
  const used = new Set<string>()
  for (const node of tree.children) {
    if (node.type !== 'heading') continue
    const depth = (node as { depth?: number }).depth
    if (depth !== 2 && depth !== 3) continue
    const text = mdastTextOf(node).trim()
    if (text) toc.push({ id: slugify(text, used), text, depth })
  }

  let chunks: string[] = [source]
  if (source.length > CHUNK_MAX_CHARS) {
    const bounds: number[] = []
    let anchor = 0
    for (const node of tree.children) {
      const off = node.position?.start?.offset
      if (off == null || off === 0) continue
      if (off - anchor >= CHUNK_MAX_CHARS) {
        bounds.push(off)
        anchor = off
      }
    }
    if (bounds.length > 0) {
      chunks = []
      let prev = 0
      for (const b of bounds) {
        chunks.push(source.slice(prev, b))
        prev = b
      }
      chunks.push(source.slice(prev))
      chunks = chunks.filter((c) => c.trim().length > 0)
    }
  }

  const plan = { chunks, toc }
  lruSet(planCache, key, plan)
  return plan
}

/** 跨块共享的渲染状态：slug 去重集合必须按块顺序共享，id 才与 TOC 一致 */
export interface RenderState {
  usedSlugs: Set<string>
}

export function createRenderState(): RenderState {
  return { usedSlugs: new Set() }
}

function hastToElement(hast: Root): ReactNode {
  return toJsxRuntime(hast, {
    Fragment,
    jsx,
    jsxs,
    components: {
      'mermaid-block': (props: { chart?: string }) =>
        createElement(Mermaid, { chart: props.chart ?? '' }),
      'copy-btn': () => createElement(CopyBtn),
      'doc-img': (props: { src?: string; alt?: string }) =>
        createElement(DocImage, { src: props.src ?? '', alt: props.alt ?? '' }),
    },
  })
}

/** 渲染单个分块；按块内容哈希缓存，state.usedSlugs 跨块共享；baseOffset 校正 data-source-* */
export async function renderMarkdownChunk(
  source: string,
  docDir: string,
  state: RenderState,
  opts: { stripFirstH1?: boolean; baseOffset?: number } = {},
): Promise<ReactNode> {
  const key = cacheKey(source, docDir, opts.stripFirstH1 ?? false, opts.baseOffset ?? 0)
  let entry = lruGet(renderCache, key)
  if (!entry) {
    const processor = buildProcessor({
      docDir,
      mode: 'rsc',
      usedSlugs: state.usedSlugs,
      stripFirstH1: opts.stripFirstH1,
      baseOffset: opts.baseOffset,
    })
    const hast = (await processor.run(processor.parse(source))) as Root
    entry = { hast, toc: [] }
    lruSet(renderCache, key, entry)
  }
  return hastToElement(entry.hast)
}
