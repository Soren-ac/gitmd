import { config } from '@/lib/core/config'
import { triggerSync } from '@/lib/git/sync'
import { isRepoCloned } from '@/lib/git/git'
import { rebuildSearchIndex } from '@/lib/search/search'
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici'

const g = globalThis as unknown as { __gitmdBooted?: boolean }

/**
 * 进程级代理：Node 全局 fetch 默认不读 HTTP(S)_PROXY，显式装一个 EnvHttpProxyAgent
 * 作为全局调度器后，进程内所有 fetch（外链图片转存等）按
 * HTTP_PROXY / HTTPS_PROXY / NO_PROXY（大小写均可）逐 URL 走代理或直连；未配置时全部直连。
 * git 走子进程：HTTPS 远端原生读这些变量；SSH 远端如需代理请在 ssh config 配 ProxyCommand。
 */
function setupGlobalProxy() {
  setGlobalDispatcher(new EnvHttpProxyAgent())
}

/** 服务启动钩子：初始克隆 + 首次同步 + 定时轮询兜底 */
export async function boot() {
  if (g.__gitmdBooted) return
  g.__gitmdBooted = true

  setupGlobalProxy()

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
