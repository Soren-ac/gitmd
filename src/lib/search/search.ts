import { db, getSetting, setSetting } from '@/lib/core/db'
import { listMarkdownFiles, readDoc } from '@/lib/content/docs'
import { config } from '@/lib/core/config'
import fs from 'node:fs'
import path from 'node:path'

/* ============================================================
 * 全文搜索：FTS5 trigram 分词。
 * trigram 把文本切成 3 字符滑窗，CJK/英文都能子串匹配，
 * 不再需要 unicode61 时代的「逐字插空格」 hacks。
 * 限制：单个查询词至少 3 个字符，更短的词走 LIKE 兜底。
 * ============================================================ */

/** 存量库的 doc_fts 若是旧分词器，重建为 trigram 并全量重索引（一次性迁移） */
function ensureTrigramFts() {
  if (getSetting('fts_tokenizer') === 'trigram') return
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'doc_fts'").get() as
    | { sql?: string }
    | undefined
  if (row?.sql?.includes('trigram')) {
    setSetting('fts_tokenizer', 'trigram')
    return
  }
  db.exec('DROP TABLE IF EXISTS doc_fts')
  db.exec("CREATE VIRTUAL TABLE doc_fts USING fts5(path UNINDEXED, title, content, tokenize='trigram')")
  setSetting('fts_tokenizer', 'trigram')
  rebuildSearchIndex()
}

/** 全量重建搜索索引（同步后调用；单仓库规模下足够快） */
export function rebuildSearchIndex() {
  const files = listMarkdownFiles()
  const insert = db.prepare('INSERT INTO doc_fts (path, title, content) VALUES (?, ?, ?)')
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM doc_fts').run()
    for (const rel of files) {
      const doc = readDoc(path.join(config.repoDir, rel))
      insert.run(rel, doc.title, doc.body)
    }
  })
  tx()
}

export function indexFile(relPath: string, title: string, body: string) {
  db.prepare('DELETE FROM doc_fts WHERE path = ?').run(relPath)
  db.prepare('INSERT INTO doc_fts (path, title, content) VALUES (?, ?, ?)').run(relPath, title, body)
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

/** 按 Unicode 字符数计长（trigram 要求 ≥3 字符的查询词） */
function charLen(s: string): number {
  return [...s].length
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => '\\' + c)
}

/** 从原文中截取包含关键词的片段，并加 <mark>（LIKE 路径的手工 snippet） */
function makeSnippet(content: string, term: string, span = 40): string {
  const idx = content.toLowerCase().indexOf(term.toLowerCase())
  if (idx < 0) return content.slice(0, span * 2)
  const start = Math.max(0, idx - span)
  const end = Math.min(content.length, idx + term.length + span)
  return (
    (start > 0 ? '…' : '') +
    content.slice(start, idx) +
    '<mark>' +
    content.slice(idx, idx + term.length) +
    '</mark>' +
    content.slice(idx + term.length, end) +
    (end < content.length ? '…' : '')
  )
}

export function searchDocs(query: string, limit = 30): SearchResult[] {
  const terms = query.split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const long = terms.filter((t) => charLen(t) >= 3)
  const short = terms.filter((t) => charLen(t) < 3)

  try {
    if (long.length > 0) {
      // 长词走 trigram 短语 MATCH，短词用 LIKE 追加过滤
      const match = long.map((t) => `"${t.replace(/"/g, '')}"`).join(' ')
      let sql = `SELECT path, title, snippet(doc_fts, 2, '<mark>', '</mark>', '…', 40) AS snippet
                 FROM doc_fts WHERE doc_fts MATCH ?`
      const params: (string | number)[] = [match]
      for (const t of short) {
        sql += ` AND (content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')`
        params.push(`%${escapeLike(t)}%`, `%${escapeLike(t)}%`)
      }
      sql += ' ORDER BY rank LIMIT ?'
      params.push(limit)
      return db.prepare(sql).all(...params) as SearchResult[]
    }

    // 全是短词：纯 LIKE 兜底，手工造 snippet；标题命中排前
    const first = short[0]
    const where = short.map(() => `(content LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')`).join(' AND ')
    const params = short.flatMap((t) => [`%${escapeLike(t)}%`, `%${escapeLike(t)}%`])
    const rows = db
      .prepare(
        `SELECT path, title, content FROM doc_fts WHERE ${where}
         ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, path LIMIT ?`,
      )
      .all(...params, `%${escapeLike(first)}%`, limit) as { path: string; title: string; content: string }[]
    return rows.map((r) => ({ path: r.path, title: r.title, snippet: makeSnippet(r.content, first) }))
  } catch {
    return []
  }
}

// 模块加载时确保 trigram 索引就位（与 db.ts 的建表迁移同风格的一次性副作用）
ensureTrigramFts()
