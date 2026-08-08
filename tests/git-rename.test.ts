import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* 回归测试：重命名必须被提交并推送。
 * 曾有的 bug：simple-git 把纯重命名放在 status.renamed 而非 staged，
 * 导致 commitAndPush 误判无变更跳过提交。 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitmd-test-git-'))
process.env.DATA_DIR = dataDir

const remoteDir = path.join(dataDir, 'remote.git')
const repoDir = path.join(dataDir, 'repo')
const git = (cwd: string, args: string) => execSync(`git ${args}`, { cwd, encoding: 'utf8' }).trim()

execSync(`git init --bare -q ${remoteDir}`)
execSync(`git clone -q ${remoteDir} ${repoDir}`)
git(repoDir, 'config user.email t@t')
git(repoDir, 'config user.name t')
git(repoDir, 'checkout -q -b main')
fs.writeFileSync(path.join(repoDir, 'a.md'), '# A\n')
git(repoDir, 'add .')
git(repoDir, 'commit -qm init')
git(repoDir, 'push -q origin main')

const { withWriteOp } = await import('../src/lib/git/git.ts')

test('重命名文件会被提交并推送到远端', async () => {
  await withWriteOp({ message: 'docs: move a.md -> b.md', author: { name: 'T', email: 't@t.local' } }, () => {
    fs.renameSync(path.join(repoDir, 'a.md'), path.join(repoDir, 'b.md'))
  })
  const remoteLog = git(remoteDir, 'log --format=%s -1 main')
  assert.equal(remoteLog, 'docs: move a.md -> b.md')
  const files = git(remoteDir, 'ls-tree --name-only main')
  assert.ok(files.includes('b.md'))
  assert.ok(!files.includes('a.md'))
})

test('内容修改同样提交推送', async () => {
  await withWriteOp({ message: 'docs: update b.md', author: { name: 'T', email: 't@t.local' } }, () => {
    fs.writeFileSync(path.join(repoDir, 'b.md'), '# B\n\n改了\n')
  })
  assert.equal(git(remoteDir, 'log --format=%s -1 main'), 'docs: update b.md')
  assert.match(git(remoteDir, 'show main:b.md'), /改了/)
})
