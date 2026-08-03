import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { db, type UserRow } from './db'
import { config } from './config'

const COOKIE_NAME = 'gitmd_session'
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000

// AUTH_SECRET 未配置时用进程级随机密钥（重启后会话全部失效，仅作兜底）
const secret = config.authSecret || randomBytes(32).toString('hex')

function sign(payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export function createSessionToken(userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + SESSION_TTL_MS }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(token: string): number | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = sign(payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { uid: number; exp: number }
    if (typeof data.uid !== 'number' || data.exp < Date.now()) return null
    return data.uid
  } catch {
    return null
  }
}

export type SessionUser = Pick<UserRow, 'id' | 'username' | 'role' | 'git_name' | 'git_email'>

/** 用户配置的 git author 身份；未配置返回 null（写操作必须拒绝） */
export function gitIdentityOf(user: SessionUser): { name: string; email: string } | null {
  const name = user.git_name?.trim()
  const email = user.git_email?.trim()
  if (!name || !email) return null
  return { name, email }
}

/** 在 RSC / route handler 中读取当前登录用户 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const token = store.get(COOKIE_NAME)?.value
  if (!token) return null
  const uid = verifySessionToken(token)
  if (uid == null) return null
  const user = db
    .prepare('SELECT id, username, role, git_name, git_email FROM users WHERE id = ?')
    .get(uid) as SessionUser | undefined
  return user ?? null
}

export async function setSessionCookie(userId: number) {
  const store = await cookies()
  store.set(COOKIE_NAME, createSessionToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export { COOKIE_NAME }
