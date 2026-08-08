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
    CREATE TABLE IF NOT EXISTS conversations (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      session_id  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);
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

/* ---------- AI 对话会话 ---------- */

export interface ConversationRow {
  id: string
  user_id: number
  title: string
  session_id: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessageRow {
  id: number
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const convStmts = {
  create: db.prepare(
    "INSERT INTO conversations (id, user_id, title, session_id) VALUES (?, ?, ?, NULL)",
  ),
  byId: db.prepare('SELECT * FROM conversations WHERE id = ?'),
  byUser: db.prepare(
    'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100',
  ),
  setSession: db.prepare(
    "UPDATE conversations SET session_id = ?, updated_at = datetime('now') WHERE id = ?",
  ),
  touch: db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"),
  remove: db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?'),
  removeMessages: db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?'),
  addMessage: db.prepare('INSERT INTO chat_messages (conversation_id, role, content) VALUES (?, ?, ?)'),
  messages: db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC'),
}

export function createConversation(id: string, userId: number, title: string) {
  convStmts.create.run(id, userId, title)
}

export function getConversation(id: string): ConversationRow | undefined {
  return convStmts.byId.get(id) as ConversationRow | undefined
}

export function listConversations(userId: number): ConversationRow[] {
  return convStmts.byUser.all(userId) as ConversationRow[]
}

export function setConversationSession(id: string, sessionId: string) {
  convStmts.setSession.run(sessionId, id)
}

export function touchConversation(id: string) {
  convStmts.touch.run(id)
}

export function deleteConversation(id: string, userId: number) {
  convStmts.removeMessages.run(id)
  convStmts.remove.run(id, userId)
}

export function addChatMessage(conversationId: string, role: 'user' | 'assistant', content: string) {
  convStmts.addMessage.run(conversationId, role, content)
}

export function listChatMessages(conversationId: string): ChatMessageRow[] {
  return convStmts.messages.all(conversationId) as ChatMessageRow[]
}
