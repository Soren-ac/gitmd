import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 必须在导入被测模块前设置：config 在模块加载时读取环境变量
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmd-test-search-'))
process.env.DATA_DIR = dataDir

const repoDir = path.join(dataDir, 'repo')
fs.mkdirSync(path.join(repoDir, 'guide'), { recursive: true })
fs.writeFileSync(path.join(repoDir, 'guide', 'deploy.md'), '# 部署指南\n\n平台的部署指南与配置说明，webhook 配置步骤。\n')
fs.writeFileSync(path.join(repoDir, 'README.md'), '# GitMD\n\nAI 对话与文档管理。\n')

const { rebuildSearchIndex, searchDocs, countDocs, indexFile, removeFromIndex } = await import('../src/lib/search/search.ts')

rebuildSearchIndex()

const paths = (rs: { path: string }[]) => rs.map((r) => r.path)

test('中文词组命中', () => {
  assert.deepEqual(paths(searchDocs('部署')), ['guide/deploy.md'])
  assert.deepEqual(paths(searchDocs('配置')), ['guide/deploy.md'])
})

test('中文中间子串命中（trigram 优势）', () => {
  assert.deepEqual(paths(searchDocs('署指南')), ['guide/deploy.md'])
})

test('英文子串命中', () => {
  assert.ok(paths(searchDocs('webhook')).includes('guide/deploy.md'))
  assert.ok(paths(searchDocs('depl')).includes('guide/deploy.md'))
})

test('短词（<3 字符）走 LIKE 兜底', () => {
  assert.ok(paths(searchDocs('部署')).includes('guide/deploy.md'))
  assert.ok(paths(searchDocs('AI')).includes('README.md'))
})

test('多词 AND 语义', () => {
  assert.ok(paths(searchDocs('部署 webhook')).includes('guide/deploy.md'))
  assert.equal(searchDocs('部署 不存在词').length, 0)
})

test('无命中返回空数组，特殊字符不抛异常', () => {
  assert.deepEqual(searchDocs('zzzzzznothing'), [])
  assert.deepEqual(searchDocs('"%_'), [])
})

test('增量索引：更新与删除', () => {
  fs.writeFileSync(path.join(repoDir, 'new.md'), '# 全新文档\n\n独特词xyzzy\n')
  indexFile('new.md', '全新文档', '全新文档\n\n独特词xyzzy\n')
  assert.ok(paths(searchDocs('xyzzy')).includes('new.md'))
  removeFromIndex('new.md')
  assert.equal(searchDocs('xyzzy').length, 0)
})

test('分页：offset 翻页覆盖全部结果，countDocs 与之一致', () => {
  // 造 5 篇含同一独特词的文档，limit=2 翻 3 页
  const created: string[] = []
  for (let i = 0; i < 5; i++) {
    const rel = `paged/doc${i}.md`
    indexFile(rel, `分页文档${i}`, `共同关键词pagerword 第${i}篇`)
    created.push(rel)
  }
  assert.equal(countDocs('pagerword'), 5)

  const seen: string[] = []
  for (let offset = 0; ; offset += 2) {
    const rs = searchDocs('pagerword', 2, offset)
    if (rs.length === 0) break
    seen.push(...paths(rs))
  }
  assert.equal(seen.length, 5)
  assert.deepEqual([...seen].sort(), created.sort())
  // offset 越界返回空
  assert.equal(searchDocs('pagerword', 2, 100).length, 0)

  for (const rel of created) removeFromIndex(rel)
  assert.equal(countDocs('pagerword'), 0)
})

test('分页：LIKE 兜底路径同样支持 offset 与计数', () => {
  indexFile('like/a.md', '短词甲', '内容含 qq 甲')
  indexFile('like/b.md', '短词乙', '内容含 qq 乙')
  assert.equal(countDocs('qq'), 2)
  assert.equal(searchDocs('qq', 1, 0).length, 1)
  assert.equal(searchDocs('qq', 1, 1).length, 1)
  assert.equal(searchDocs('qq', 1, 2).length, 0)
  removeFromIndex('like/a.md')
  removeFromIndex('like/b.md')
})
