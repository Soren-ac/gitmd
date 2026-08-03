import { repoQueue, syncRepo, isRepoCloned, ensureCloned } from './git'
import { rebuildSearchIndex } from './search'
import { updateSyncState } from './db'

/** 触发一次同步（入队串行执行）。供 webhook / 轮询 / 手动同步调用。 */
export function triggerSync(): Promise<{ ok: boolean; error?: string }> {
  return repoQueue.enqueue(async () => {
    try {
      await ensureCloned()
      const result = await syncRepo()
      if (result.changed) rebuildSearchIndex()
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
