import { db } from '@/lib/core/db'
import { listMarkdownFiles, readDoc } from '@/lib/content/docs'
import { config } from '@/lib/core/config'
import fs from 'node:fs'
import path from 'node:path'

/**
 * FTS5 unicode61 分词器会把连续中文当作一个 token，无法子串匹配。
 * 索引与查询时都在 CJK 字符间插入空格，把每个汉字变成独立 token，
 * 查询侧同样处理后加引号做短语匹配。
 */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/

export function expandCJK(text: string): string {
  let out = ''
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += ' '
      out += ch + ' '
    } else {
      out += ch
    }
  }
  return out
}

function normalizeQuery(query: string): string {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${expandCJK(t).replace(/"/g, '').replace(/\s+/g, ' ').trim()}"`)
    .filter((t) => t !== '""')
  return terms.join(' ')
}

/** 把 snippet 里 CJK 之间的空格去掉，还原显示 */
function compressCJK(text: string): string {
  return text
    .replace(/([぀-ヿ㐀-䶿一-鿿豈-﫿])\s+(?=[぀-ヿ㐀-䶿一-鿿豈-﫿])/g, '$1')
    .trim()
}

/** 全量重建搜索索引（同步后调用；单仓库规模下足够快） */
export function rebuildSearchIndex() {
  const files = listMarkdownFiles()
  const insert = db.prepare('INSERT INTO doc_fts (path, title, content) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM doc_fts').run()
    for (const rel of files) {
      const doc = readDoc(path.join(config.repoDir, rel))
      insert.run(rel, expandCJK(doc.title), expandCJK(doc.body))
    }
  })
  tx()
}

export function indexFile(relPath: string, title: string, body: string) {
  db.prepare('DELETE FROM doc_fts WHERE path = ?').run(relPath)
  db.prepare('INSERT INTO doc_fts (path, title, content) VALUES (?, ?, ?)').run(
    relPath,
    expandCJK(title),
    expandCJK(body),
  )
}

export function removeFromIndex(relPath: string) {
  db.prepare('DELETE FROM doc_fts WHERE path = ?').run(relPath)
}

/**
 * 同步后的增量索引：只刷新变更的 md 文件（修改/新增重建，删除移除）。
 * 避免每次同步都全量重建——全量重建在仓库变大后会阻塞事件循环。
 */
export function updateSearchIndex(changedFiles: string[]) {
  const tx = db.transaction(() => {
    for (const rel of changedFiles) {
      if (!/\.mdx?$/i.test(rel)) continue
      const abs = path.join(config.repoDir, rel)
      if (fs.existsSync(abs)) {
        const doc = readDoc(abs)
        indexFile(rel, doc.title, doc.body)
      } else {
        removeFromIndex(rel)
      }
    }
  })
  tx()
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
}

export function searchDocs(query: string, limit = 30): SearchResult[] {
  const match = normalizeQuery(query)
  if (!match) return []
  try {
    const rows = db
      .prepare(
        `SELECT path, title, snippet(doc_fts, 2, '<mark>', '</mark>', '…', 40) AS snippet
         FROM doc_fts WHERE doc_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as SearchResult[]
    return rows.map((r) => ({ ...r, title: compressCJK(r.title), snippet: compressCJK(r.snippet) }))
  } catch {
    return []
  }
}
