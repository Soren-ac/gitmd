import fs from 'node:fs'
import path from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { config } from './config'

export class ConflictError extends Error {
  constructor(
    message: string,
    public readonly currentContent?: string,
    public readonly currentHash?: string,
  ) {
    super(message)
    this.name = 'ConflictError'
  }
}

/** 仓库级串行队列：同步与编辑操作全部排队执行，保证 git 操作不并发 */
class RepoQueue {
  private tail: Promise<unknown> = Promise.resolve()

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn)
    this.tail = result.catch(() => {})
    return result
  }
}

export const repoQueue = new RepoQueue()

/** simple-git 的 .env() 会整体替换子进程环境，必须显式合并 process.env，否则丢 PATH/HOME/代理/凭据配置 */
function mergedEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue
    // simple-git 出于安全默认禁止 EDITOR 类变量；平台无需交互式编辑器
    if (k === 'EDITOR' || k === 'VISUAL' || k === 'GIT_EDITOR') continue
    env[k] = v
  }
  return { GIT_TERMINAL_PROMPT: '0', ...env, ...extra }
}

function makeGit(): SimpleGit {
  fs.mkdirSync(config.repoDir, { recursive: true })
  const extra: Record<string, string> = {
    GIT_COMMITTER_NAME: config.botName,
    GIT_COMMITTER_EMAIL: config.botEmail,
  }
  if (config.sshKeyPath) {
    extra.GIT_SSH_COMMAND = `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`
  }
  return simpleGit({ baseDir: config.repoDir, trimmed: true }).env(mergedEnv(extra))
}

const g = globalThis as unknown as { __gitmdGit?: SimpleGit }
export const git: SimpleGit = (g.__gitmdGit ??= makeGit())

export function isRepoCloned(): boolean {
  return fs.existsSync(path.join(config.repoDir, '.git'))
}

/** 首次启动克隆仓库；已存在则跳过 */
export async function ensureCloned(): Promise<void> {
  if (isRepoCloned()) return
  if (!config.repoUrl) throw new Error('REPO_URL 未配置，无法克隆仓库')
  fs.mkdirSync(config.repoDir, { recursive: true })
  // clone 到临时目录再移动，避免半截状态
  const tmp = `${config.repoDir}.cloning`
  fs.rmSync(tmp, { recursive: true, force: true })
  const extra: Record<string, string> = {}
  if (config.sshKeyPath) {
    extra.GIT_SSH_COMMAND = `ssh -i ${config.sshKeyPath} -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes`
  }
  await simpleGit().env(mergedEnv(extra)).clone(config.repoUrl, tmp, ['--branch', config.branch, '--single-branch'])
  fs.rmSync(config.repoDir, { recursive: true, force: true })
  fs.renameSync(tmp, config.repoDir)
}

export interface SyncResult {
  changed: boolean
  changedFiles: string[]
  head: string
}

/**
 * 同步：fetch + reset --hard origin/branch（远端权威，永不冲突）。
 * 必须在 RepoQueue 内调用。
 */
export async function syncRepo(): Promise<SyncResult> {
  await git.fetch('origin', config.branch)
  const local = await git.revparse(['HEAD']).catch(() => '')
  const remote = await git.revparse([`origin/${config.branch}`])
  if (local === remote) return { changed: false, changedFiles: [], head: remote }

  let changedFiles: string[] = []
  if (local) {
    const out = await git.raw(['diff', '--name-only', local, remote]).catch(() => '')
    changedFiles = out.split('\n').filter(Boolean)
  }
  await git.reset(['--hard', `origin/${config.branch}`])
  return { changed: true, changedFiles, head: remote }
}

async function pushWithRetry(maxAttempts = 3): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await git.push('origin', `HEAD:${config.branch}`)
      return
    } catch (err) {
      if (attempt === maxAttempts) throw err
      // 远端有新提交：fetch + rebase 后再推
      await git.fetch('origin', config.branch)
      try {
        await git.rebase([`origin/${config.branch}`])
      } catch {
        await git.raw(['rebase', '--abort']).catch(() => {})
        await git.reset(['--hard', `origin/${config.branch}`]).catch(() => {})
        throw new ConflictError('远端存在冲突修改，自动合并失败，请刷新后重试')
      }
    }
  }
}

/** git author 字段清洗：去掉会破坏 author 格式的字符 */
function sanitizeAuthorField(s: string): string {
  return s.replace(/[<>"'\\\n\r]/g, '').trim()
}

async function commitAndPush(
  message: string,
  author: { name: string; email: string },
): Promise<string> {
  await git.add('.')
  const status = await git.status()
  if (status.staged.length > 0) {
    const name = sanitizeAuthorField(author.name)
    const email = sanitizeAuthorField(author.email)
    await git.raw(['commit', '-m', message, `--author=${name} <${email}>`])
  }
  // 即使本次没有新提交，本地也可能因上次 push 失败而领先远端——必须与远端对齐后再返回
  const local = await git.revparse(['HEAD'])
  const remote = await git.revparse([`origin/${config.branch}`]).catch(() => '')
  if (local !== remote) {
    await pushWithRetry()
  }
  return git.revparse(['HEAD'])
}

export interface WriteOp {
  message: string
  author: { name: string; email: string }
}

/** 在队列中执行一个写操作并提交推送。fn 内直接操作工作区文件。 */
export async function withWriteOp<T>(op: WriteOp, fn: () => Promise<T> | T): Promise<{ result: T; head: string }> {
  return repoQueue.enqueue(async () => {
    const result = await fn()
    const head = await commitAndPush(op.message, op.author)
    return { result, head }
  })
}

/** 在队列中执行只读 git 操作（log/diff 等，与工作区写互斥） */
export async function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
  return repoQueue.enqueue(fn)
}

export interface LogEntry {
  hash: string
  abbrev: string
  author: string
  date: string
  message: string
}

export async function fileLog(relPath: string, max = 50): Promise<LogEntry[]> {
  const out = await git.raw([
    'log',
    `--max-count=${max}`,
    '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s',
    '--date=iso',
    '--',
    relPath,
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, abbrev, author, date, message] = line.split('\x1f')
      return { hash, abbrev, author, date, message }
    })
}

export async function diffBetween(relPath: string, from: string, to: string): Promise<string> {
  return git.raw(['diff', `${from}..${to}`, '--', relPath])
}

export async function showAtCommit(relPath: string, ref: string): Promise<string> {
  return git.raw(['show', `${ref}:${relPath}`])
}
