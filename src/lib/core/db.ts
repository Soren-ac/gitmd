import Database from 'better-sqlite3'
import fs from 'node:fs'
import { config } from '@/lib/core/config'
import { hashPassword } from '@/lib/auth/auth-core'

export interface UserRow {
  id: number
  username: string
  password_hash: string
  role: 'admin' | 'member'
  git_name: string | null
  git_email: string | null
  created_at: string
}

function createDb(): Database.Database {
  fs.mkdirSync(config.dataDir, { recursive: true })
  const db = new Database(config.dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'member',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_state (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      last_head    TEXT,
      last_sync_at TEXT,
      last_status  TEXT,
      last_error   TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS doc_fts USING fts5(
      path UNINDEXED,
      title,
      content,
      tokenize = 'unicode61'
    );
  `)
  // 迁移：users 表增加 git 身份列
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name)
  if (!userCols.includes('git_name')) db.prepare('ALTER TABLE users ADD COLUMN git_name TEXT').run()
  if (!userCols.includes('git_email')) db.prepare('ALTER TABLE users ADD COLUMN git_email TEXT').run()
  // 播种 admin 账号
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  if (count.n === 0) {
    const password = config.adminPassword || 'admin123'
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      config.adminUsername,
      hashPassword(password),
      'admin',
    )
    console.log(`[gitmd] 已创建初始管理员账号: ${config.adminUsername}${config.adminPassword ? '' : '（默认密码 admin123，请尽快修改）'}`)
  }
  return db
}

// dev 热重载时复用同一连接
const g = globalThis as unknown as { __gitmdDb?: Database.Database }
export const db: Database.Database = (g.__gitmdDb ??= createDb())

// 高频语句预编译（会话/设置/同步状态）
const stmts = {
  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
  ),
  deleteSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
  getSyncState: db.prepare('SELECT * FROM sync_state WHERE id = 1'),
  upsertSyncState: db.prepare(
    `INSERT INTO sync_state (id, last_head, last_sync_at, last_status, last_error)
     VALUES (1, ?, datetime('now'), ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_head=excluded.last_head, last_sync_at=excluded.last_sync_at,
       last_status=excluded.last_status, last_error=excluded.last_error`,
  ),
}

export function updateSyncState(status: 'ok' | 'error', head: string | null, error?: string) {
  stmts.upsertSyncState.run(head, status, error ?? null)
}

export function getSyncState() {
  return stmts.getSyncState.get() as
    | { last_head: string | null; last_sync_at: string | null; last_status: string | null; last_error: string | null }
    | undefined
}

/* ---------- 平台级配置（管理界面可改，优先级高于同名环境变量） ---------- */

export function getSetting(key: string): string | null {
  const row = stmts.getSetting.get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string) {
  stmts.setSetting.run(key, value)
}

export function deleteSetting(key: string) {
  stmts.deleteSetting.run(key)
}

/** webhook 验签密钥：界面配置（DB）优先，其次 WEBHOOK_SECRET 环境变量 */
export function getWebhookSecret(): string {
  return getSetting('webhook_secret') ?? config.webhookSecret
}
