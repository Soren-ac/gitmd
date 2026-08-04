import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { config } from '@/lib/core/config'
import { splitFrontmatter } from '@/lib/markdown/frontmatter'

/** 把 URL 路径段解析为仓库内的安全绝对路径；越界返回 null */
export function resolveSafe(segments: string[]): string | null {
  const rel = segments.map(decodeURIComponent).join('/')
  const abs = path.normalize(path.join(config.repoDir, rel))
  if (abs !== config.repoDir && !abs.startsWith(config.repoDir + path.sep)) return null
  return abs
}

export function toRel(abs: string): string {
  return path.relative(config.repoDir, abs).split(path.sep).join('/')
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export interface TreeNode {
  name: string
  path: string // 仓库相对路径
  type: 'dir' | 'file'
  children?: TreeNode[]
}

const IGNORED = new Set(['.git', 'node_modules', '.next', 'assets'])

/** 文档树：目录 + md 文件（assets 等资源目录不进树） */
export function buildTree(dir: string = config.repoDir): TreeNode[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue
    if (IGNORED.has(e.name)) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      const children = buildTree(abs)
      if (children.length > 0) {
        nodes.push({ name: e.name, path: toRel(abs), type: 'dir', children })
      }
    } else if (/\.mdx?$/i.test(e.name)) {
      nodes.push({ name: e.name, path: toRel(abs), type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return nodes
}

export function extractTitle(content: string, fallback: string): string {
  const { frontmatter, body } = splitFrontmatter(content)
  const fmTitle = frontmatter.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)
  if (fmTitle) return fmTitle[1]
  const heading = body.match(/^#\s+(.+)$/m)
  if (heading) return heading[1].trim()
  return fallback
}

export interface DocData {
  exists: boolean
  content: string
  frontmatter: string
  body: string
  title: string
  hash: string
}

export function readDoc(abs: string): DocData {
  const fallback = path.basename(abs).replace(/\.mdx?$/i, '')
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { exists: false, content: '', frontmatter: '', body: '', title: fallback, hash: '' }
  }
  const content = fs.readFileSync(abs, 'utf8')
  const { frontmatter, body } = splitFrontmatter(content)
  return {
    exists: true,
    content,
    frontmatter,
    body,
    title: extractTitle(content, fallback),
    hash: contentHash(content),
  }
}

/** 列出仓库内全部 md 文件（含 assets 之外的资源目录除外） */
export function listMarkdownFiles(dir: string = config.repoDir, out: string[] = []): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue
      listMarkdownFiles(path.join(dir, e.name), out)
    } else if (/\.mdx?$/i.test(e.name)) {
      out.push(toRel(path.join(dir, e.name)))
    }
  }
  return out
}
