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

const { rebuildSearchIndex, searchDocs, indexFile, removeFromIndex } = await import('../src/lib/search/search.ts')

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
