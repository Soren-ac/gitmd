import { config } from './config'
import { triggerSync } from './sync'
import { isRepoCloned } from './git'
import { rebuildSearchIndex } from './search'

const g = globalThis as unknown as { __gitmdBooted?: boolean }

/** 服务启动钩子：初始克隆 + 首次同步 + 定时轮询兜底 */
export async function boot() {
  if (g.__gitmdBooted) return
  g.__gitmdBooted = true

  if (!config.repoUrl) {
    console.warn('[gitmd] REPO_URL 未配置，请在环境变量中设置仓库地址后重启')
    return
  }

  console.log(`[gitmd] 启动：仓库 ${config.repoUrl} (分支 ${config.branch})`)
  if (!isRepoCloned()) console.log('[gitmd] 首次运行，正在克隆仓库…')

  // 初始同步（含克隆），失败由轮询兜底重试
  const first = await triggerSync()
  if (first.ok) rebuildSearchIndex() // 克隆时 HEAD 不变不会触发重建，启动时无条件建一次
  console.log(first.ok ? '[gitmd] 初始同步完成' : `[gitmd] 初始同步失败: ${first.error}，将定期重试`)

  const timer = setInterval(() => {
    triggerSync().catch(() => {})
  }, config.pollIntervalMs)
  timer.unref()
  console.log(`[gitmd] 轮询兜底已启动，间隔 ${config.pollIntervalMs / 1000}s`)
}
