import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* 全库最近变更流：只跟踪 md 文档（.gitmd/ sidecar 与 assets 不出现），
 * 按提交分组，重命名识别为 R 并带 oldPath。 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmd-test-recent-'))
process.env.DATA_DIR = dataDir

const remoteDir = path.join(dataDir, 'remote.git')
const repoDir = path.join(dataDir, 'repo')
const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim()

execSync(`git init --bare -q ${remoteDir}`)
execSync(`git clone -q ${remoteDir} ${repoDir}`)
git(repoDir, 'config user.email t@t')
git(repoDir, 'config user.name t')
git(repoDir, 'checkout -q -b main')

// 提交 1：新增 md + 批注 sidecar（sidecar 不应出现在变更流）
fs.writeFileSync(path.join(repoDir, 'a.md'), '# A\n')
fs.mkdirSync(path.join(repoDir, '.gitmd', 'annotations'), { recursive: true })
fs.writeFileSync(path.join(repoDir, '.gitmd', 'annotations', 'a.md.yaml'), '[]\n')
git(repoDir, 'add .')
git(repoDir, 'commit -qm "docs: add a"')

// 提交 2：修改 md + 新增图片（assets 不应出现）
fs.writeFileSync(path.join(repoDir, 'a.md'), '# A\n\n改了\n')
fs.mkdirSync(path.join(repoDir, 'assets'), { recursive: true })
fs.writeFileSync(path.join(repoDir, 'assets', 'x.png'), 'png')
git(repoDir, 'add .')
git(repoDir, 'commit -qm "docs: update a"')

// 提交 3：重命名 md
git(repoDir, 'mv a.md b.md')
git(repoDir, 'commit -qm "docs: rename a to b"')
git(repoDir, 'push -q origin main')

const { recentChanges } = await import('../src/lib/git/git.ts')

test('按提交分组、时间倒序，只含 md 文件', async () => {
  const entries = await recentChanges(10)
  assert.equal(entries.length, 3)
  assert.equal(entries[0].message, 'docs: rename a to b')
  assert.equal(entries[1].message, 'docs: update a')
  assert.equal(entries[2].message, 'docs: add a')

  // sidecar / assets 不出现
  const allFiles = entries.flatMap((e) => e.files.map((f) => f.path))
  assert.ok(allFiles.every((f) => f.endsWith('.md')))
  assert.ok(!allFiles.some((f) => f.includes('.gitmd') || f.includes('assets/')))

  // 状态识别
  assert.equal(entries[2].files[0].status, 'A')
  assert.equal(entries[1].files[0].status, 'M')
  const rename = entries[0].files[0]
  assert.equal(rename.status, 'R')
  assert.equal(rename.oldPath, 'a.md')
  assert.equal(rename.path, 'b.md')
})
