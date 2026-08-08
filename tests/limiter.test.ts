import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWithLimit } from '../src/lib/ai/limiter.ts'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('同一用户的请求串行执行', async () => {
  const order: string[] = []
  await Promise.all([
    runWithLimit(1, () => {}, async () => {
      await sleep(40)
      order.push('u1-first')
    }),
    runWithLimit(1, () => {}, async () => {
      order.push('u1-second')
    }),
  ])
  assert.deepEqual(order, ['u1-first', 'u1-second'])
})

test('不同用户可并行，但全局并发不超过 4', async () => {
  let concurrent = 0
  let peak = 0
  const task = () => async () => {
    concurrent++
    peak = Math.max(peak, concurrent)
    await sleep(30)
    concurrent--
  }
  await Promise.all(Array.from({ length: 8 }, (_, i) => runWithLimit(i + 100, () => {}, task())))
  assert.ok(peak <= 4, `峰值并发 ${peak} 应 ≤ 4`)
})

test('排队时触发 onQueued', async () => {
  let queued = 0
  const slow = () => async () => sleep(60)
  // 占满全局 4 个槽位
  const blockers = Array.from({ length: 4 }, (_, i) => runWithLimit(i + 200, () => {}, slow()))
  await sleep(10)
  const waiting = runWithLimit(999, () => queued++, async () => {})
  await Promise.all([...blockers, waiting])
  assert.equal(queued, 1)
})

test('fn 抛错不影响后续排队者', async () => {
  const order: string[] = []
  await Promise.all([
    runWithLimit(1, () => {}, async () => {
      throw new Error('boom')
    }).catch(() => order.push('failed')),
    runWithLimit(1, () => {}, async () => {
      order.push('after-failure')
    }),
  ])
  assert.deepEqual(order, ['failed', 'after-failure'])
})
