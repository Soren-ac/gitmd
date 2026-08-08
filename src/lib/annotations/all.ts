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

/** 扫描仓库 .gitmd/annotations/ 下全部 sidecar，返回解析后的完整批注 */
function scanAllAnnotations(): Annotation[] {
  const root = path.join(config.repoDir, '.gitmd', 'annotations')
  const out: Annotation[] = []
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
      out.push(...readAnnotations(docRel))
    }
  }
  walk(root)
  return out
}

/* 全库批注快照缓存：递归扫盘 + 解析所有 YAML 是 I/O 密集操作，而批注只在写操作
 * （全部经 withWriteOp 提交）或同步（reset --hard/克隆）后才会变化，失效点与文件树
 * 缓存完全一致，由 git.ts 在同一批位置显式失效。放 globalThis 的原因同树缓存——
 * Next 可能把不同路由编成不同模块实例。 */
const gAnn = globalThis as unknown as { __gitmdAnnotationsCache?: Annotation[] | null }

export function invalidateAnnotationsCache() {
  gAnn.__gitmdAnnotationsCache = null
}

/** 带缓存的全库批注快照（完整 comments，供批注中心 / @提及等聚合场景共用） */
export function getAllAnnotations(): Annotation[] {
  if (gAnn.__gitmdAnnotationsCache) return gAnn.__gitmdAnnotationsCache
  if (!fs.existsSync(path.join(config.repoDir, '.git'))) return []
  gAnn.__gitmdAnnotationsCache = scanAllAnnotations()
  return gAnn.__gitmdAnnotationsCache
}

/** 全库批注列表（批注中心用，按创建时间倒序） */
export function listAllAnnotations(): AnnotationListItem[] {
  return getAllAnnotations()
    .map((a) => {
      const last = a.comments[a.comments.length - 1] ?? null
      return {
        id: a.id,
        doc: a.doc,
        quote: a.anchor.quote,
        author: a.author,
        created_at: a.created_at,
        resolved: a.resolved,
        commentCount: a.comments.length,
        lastComment: last ? { author: last.author, body: last.body.slice(0, 120), at: last.at } : null,
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}
