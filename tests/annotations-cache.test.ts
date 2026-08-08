import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* 全库批注快照缓存：读取走缓存，写操作提交后自动失效能看到新批注。
 * 失效点与文件树缓存共用 git.ts 的 invalidateRepoCaches。 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmd-test-ann-'))
process.env.DATA_DIR = dataDir

const remoteDir = path.join(dataDir, 'remote.git')
const repoDir = path.join(dataDir, 'repo')
const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim()

execSync(`git init --bare -q ${remoteDir}`)
execSync(`git clone -q ${remoteDir} ${repoDir}`)
git(repoDir, 'config user.email t@t')
git(repoDir, 'config user.name t')
git(repoDir, 'checkout -q -b main')
fs.writeFileSync(path.join(repoDir, 'a.md'), '# A\n\n正文内容\n')
git(repoDir, 'add .')
git(repoDir, 'commit -qm init')
git(repoDir, 'push -q origin main')

const { getAllAnnotations, listAllAnnotations } = await import('../src/lib/annotations/all.ts')
const { saveNew, makeAnnotation } = await import('../src/lib/annotations/annotations.ts')
const { withWriteOp } = await import('../src/lib/git/git.ts')

const anchor = { quote: '正文内容', prefix: '', suffix: '', start: 5, end: 9, base: 'x', section: 'A' }

test('空仓库返回空列表，写操作提交后缓存失效读到新批注', async () => {
  assert.equal(getAllAnnotations().length, 0)
  // 触发一次缓存填充
  assert.equal(listAllAnnotations().length, 0)

  await withWriteOp({ message: 'anno: add', author: { name: 'T', email: 't@t.local' } }, () => {
    saveNew('a.md', makeAnnotation('a.md', anchor, 'tobias', '第一条批注'))
  })

  const all = getAllAnnotations()
  assert.equal(all.length, 1)
  assert.equal(all[0].comments[0].body, '第一条批注')

  const items = listAllAnnotations()
  assert.equal(items.length, 1)
  assert.equal(items[0].doc, 'a.md')
  assert.equal(items[0].commentCount, 1)
  assert.equal(items[0].lastComment?.author, 'tobias')
})

test('同步 reset 后缓存失效（远端带入的 sidecar 可见）', async () => {
  // 模拟另一处克隆推上来的批注：直接写 sidecar 提交推送
  const yaml = `- id: abcd1234
  doc: a.md
  anchor:
    quote: 正文内容
    prefix: ''
    suffix: ''
    start: 5
    end: 9
    base: x
    section: A
  author: someone
  created_at: '2026-01-01T00:00:00.000Z'
  resolved: false
  comments:
    - author: someone
      body: 远端来的批注
      at: '2026-01-01T00:00:00.000Z'
`
  const sidecar = path.join(repoDir, '.gitmd', 'annotations', 'a.md.yaml')
  // 直接改工作区 + commit + push（等价于远端变更经同步 reset 进来的最终状态）
  fs.mkdirSync(path.dirname(sidecar), { recursive: true })
  const before = getAllAnnotations().length
  fs.appendFileSync(sidecar, yaml)
  git(repoDir, 'add .')
  git(repoDir, 'commit -qm remote-anno')
  // 绕过平台的 withWriteOp 直接操作 git——缓存不会被主动失效，
  // 模拟 syncRepo 的失效行为
  const { invalidateAnnotationsCache } = await import('../src/lib/annotations/all.ts')
  invalidateAnnotationsCache()
  assert.equal(getAllAnnotations().length, before + 1)
})
