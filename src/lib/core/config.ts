import path from 'node:path'

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data')

export const config = {
  dataDir: DATA_DIR,
  repoDir: path.join(DATA_DIR, 'repo'),
  dbPath: path.join(DATA_DIR, 'gitmd.db'),
  /** 远端仓库地址（SSH 或 HTTPS），必填 */
  repoUrl: process.env.REPO_URL ?? '',
  branch: process.env.REPO_BRANCH ?? 'main',
  /** SSH deploy key 路径（挂进容器），SSH 地址时必填 */
  sshKeyPath: process.env.GIT_SSH_KEY ?? '',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 600_000),
  authSecret: process.env.AUTH_SECRET ?? '',
  adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  botName: process.env.GIT_BOT_NAME ?? 'gitmd-bot',
  botEmail: process.env.GIT_BOT_EMAIL ?? 'gitmd@local',
} as const

if (!config.authSecret && process.env.NODE_ENV === 'production') {
  console.warn('[gitmd] WARNING: AUTH_SECRET 未设置，会话签名使用随机密钥，重启后所有会话失效')
}
