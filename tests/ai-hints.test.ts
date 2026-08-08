import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* AI 检索增强：提问经 FTS5 搜出候选文档注入 prompt 线索；
 * 线索须去掉 <mark> 高亮标签，无命中/索引异常时返回空串不阻断对话。 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmd-test-aihints-'))
process.env.DATA_DIR = dataDir

const repoDir = path.join(dataDir, 'repo')
fs.mkdirSync(path.join(repoDir, 'guide'), { recursive: true })
fs.writeFileSync(path.join(repoDir, 'guide', 'deploy.md'), '# 部署指南\n\n平台的部署指南与配置说明，webhook 配置步骤。\n')

const { rebuildSearchIndex } = await import('../src/lib/search/search.ts')
rebuildSearchIndex()

const { retrievalHints } = await import('../src/lib/ai/chat.ts')

test('命中时产出检索线索并指向候选文档', () => {
  const hints = retrievalHints('怎么配置 webhook')
  assert.ok(hints.includes('【检索线索】'))
  assert.ok(hints.includes('guide/deploy.md'))
  assert.ok(!hints.includes('<mark>'), '线索里不应残留高亮标签')
})

test('无命中返回空串', () => {
  assert.equal(retrievalHints('zzzzz完全不存在的词'), '')
})
