/* ============================================================
 * AI 对话并发控制：每条消息会 spawn 一个 CLI 子进程，
 * 没有上限会被连点打爆模型端点。规则：同一用户串行，全局最多
 * MAX_CONCURRENT 路并行，超出的排队等待。
 * ============================================================ */

const MAX_CONCURRENT = 4

let active = 0
const globalQueue: Array<() => void> = []
const busyUsers = new Set<number>()
const userTails = new Map<number, Promise<unknown>>()

async function acquireGlobal() {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => globalQueue.push(resolve))
  }
  active++
}

function releaseGlobal() {
  active--
  const next = globalQueue.shift()
  if (next) next()
}

/**
 * 在限流栅栏内执行 fn。同一用户的请求排队串行；全局并发超限时等待。
 * 进入等待时调用一次 onQueued（用于给前端发「排队中」提示）。
 */
export function runWithLimit<T>(userId: number, onQueued: () => void, fn: () => Promise<T>): Promise<T> {
  const prev = userTails.get(userId)
  const wasBusy = busyUsers.has(userId)

  const result = (prev ?? Promise.resolve()).then(async () => {
    if (wasBusy || active >= MAX_CONCURRENT) onQueued()
    busyUsers.add(userId)
    await acquireGlobal()
    try {
      return await fn()
    } finally {
      releaseGlobal()
      busyUsers.delete(userId)
    }
  })

  // 链条上挂永不 reject 的副本，避免一个失败影响后续排队者
  userTails.set(userId, result.catch(() => {}))
  return result
}
