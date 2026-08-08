import fs from 'node:fs'
import path from 'node:path'
import { config } from '@/lib/core/config'
import { readAnnotations, type Annotation } from '@/lib/annotations/annotations'

export interface AnnotationListItem {
  id: string
  doc: string
  quote: string
  author: string
  created_at: string
  resolved: boolean
  commentCount: number
  lastComment: { author: string; body: string; at: string } | null
}

/** 扫描仓库 .gitmd/annotations/ 下全部 sidecar，汇总所有批注 */
export function listAllAnnotations(): AnnotationListItem[] {
  const root = path.join(config.repoDir, '.gitmd', 'annotations')
  const out: AnnotationListItem[] = []
  const walk = (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(abs)
        continue
      }
      if (!e.name.endsWith('.yaml')) continue
      const docRel = path.relative(root, abs).split(path.sep).join('/').replace(/\.yaml$/, '')
      let list: Annotation[] = []
      try {
        list = readAnnotations(docRel)
      } catch {
        continue
      }
      for (const a of list) {
        const last = a.comments[a.comments.length - 1] ?? null
        out.push({
          id: a.id,
          doc: a.doc,
          quote: a.anchor.quote,
          author: a.author,
          created_at: a.created_at,
          resolved: a.resolved,
          commentCount: a.comments.length,
          lastComment: last ? { author: last.author, body: last.body.slice(0, 120), at: last.at } : null,
        })
      }
    }
  }
  walk(root)
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
}
