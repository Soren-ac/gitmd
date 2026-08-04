import { repoQueue, syncRepo, isRepoCloned, ensureCloned } from '@/lib/git/git'
import { rebuildSearchIndex, updateSearchIndex } from '@/lib/search/search'
import { updateSyncState } from '@/lib/core/db'

/** 触发一次同步（入队串行执行）。供 webhook / 轮询 / 手动同步调用。 */
export function triggerSync(): Promise<{ ok: boolean; error?: string }> {
  return repoQueue.enqueue(async () => {
    try {
      await ensureCloned()
      const result = await syncRepo()
      if (result.changed) {
        // 有变更清单时增量索引；清单为空（如首次建立 HEAD）退化为全量重建兜底
        if (result.changedFiles.length > 0) updateSearchIndex(result.changedFiles)
        else rebuildSearchIndex()
      }
      updateSyncState('ok', result.head)
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[gitmd] 同步失败:', message)
      updateSyncState('error', null, message)
      return { ok: false, error: message }
    }
  })
}

export { isRepoCloned }
