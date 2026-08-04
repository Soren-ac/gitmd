'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, RefreshCw, Trash2, UserPlus, Users, Database } from 'lucide-react'
import { useToast } from '@/components/common/Toast'
import { useDialog } from '@/components/common/Dialog'

interface SyncInfo {
  repoCloned: boolean
  repoUrl: string
  branch: string
  pollIntervalMs: number
  state: {
    last_head: string | null
    last_sync_at: string | null
    last_status: string | null
    last_error: string | null
  } | null
}

interface UserItem {
  id: number
  username: string
  role: string
  created_at: string
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td style={{ color: 'var(--text-secondary)', width: 130, fontSize: 13 }}>{label}</td>
      <td>{children}</td>
    </tr>
  )
}

export default function AdminPanel({ currentUserId }: { currentUserId: number }) {
  const router = useRouter()
  const toast = useToast()
  const dialog = useDialog()
  const [sync, setSync] = useState<SyncInfo | null>(null)
  const [users, setUsers] = useState<UserItem[] | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'member' })

  async function load() {
    const [s, u] = await Promise.all([fetch('/api/sync'), fetch('/api/admin/users')])
    if (s.ok) setSync(await s.json())
    if (u.ok) setUsers((await u.json()).users)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步加载完成后才 setState
    load()
  }, [])

  async function manualSync() {
    setSyncing(true)
    const res = await fetch('/api/sync', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setSyncing(false)
    toast.push(res.ok ? 'success' : 'error', res.ok ? '同步完成' : '同步失败：' + (data.error ?? ''))
    load()
    router.refresh()
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUser),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      toast.push('success', `用户 ${newUser.username} 已创建`)
      setNewUser({ username: '', password: '', role: 'member' })
      load()
    } else {
      toast.push('error', data.error ?? '创建失败')
    }
  }

  async function deleteUser(u: UserItem) {
    const ok = await dialog.confirm({
      title: '删除用户',
      message: `确定删除用户 ${u.username}？该用户将无法再登录平台。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
    toast.push('success', `已删除用户 ${u.username}`)
    load()
  }

  async function resetPassword(u: UserItem) {
    const password = await dialog.prompt({
      title: '重置密码',
      message: `为 ${u.username} 设置新密码（至少 6 位）。`,
      input: { placeholder: '新密码' },
    })
    if (!password) return
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    toast.push(res.ok ? 'success' : 'error', res.ok ? '密码已重置' : '重置失败')
  }

  return (
    <div>
      <section className="admin-section">
        <h2>
          <Database size={16} style={{ color: 'var(--text-tertiary)' }} />
          仓库同步
        </h2>
        <div className="card" style={{ maxWidth: 760 }}>
          {!sync ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 15}%` }} />
              ))}
            </div>
          ) : (
            <table className="admin-table">
              <tbody>
                <InfoRow label="仓库">
                  <span className="mono" style={{ fontSize: 12.5 }}>{sync.repoUrl || '未配置'}</span>
                </InfoRow>
                <InfoRow label="分支">
                  <code style={{ fontSize: 12 }}>{sync.branch}</code>
                </InfoRow>
                <InfoRow label="状态">
                  {sync.repoCloned ? (
                    <span className="status-dot ok">已克隆</span>
                  ) : (
                    <span className="status-dot err">未克隆</span>
                  )}
                </InfoRow>
                <InfoRow label="最近同步">
                  {sync.state?.last_sync_at ?? '—'}
                  {sync.state?.last_error && (
                    <div className="error-text" style={{ marginTop: 4 }}>{sync.state.last_error}</div>
                  )}
                </InfoRow>
                <InfoRow label="HEAD">
                  <code style={{ fontSize: 12 }}>{sync.state?.last_head?.slice(0, 10) ?? '—'}</code>
                </InfoRow>
                <InfoRow label="轮询间隔">{sync.pollIntervalMs / 1000}s</InfoRow>
              </tbody>
            </table>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" onClick={manualSync} disabled={syncing}>
            {syncing ? <span className="spinner" /> : <RefreshCw size={13} />}
            立即同步
          </button>
        </div>
      </section>

      <section className="admin-section">
        <h2>
          <Users size={16} style={{ color: 'var(--text-tertiary)' }} />
          用户管理
        </h2>
        <div className="card" style={{ maxWidth: 760 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th style={{ width: 90 }}>角色</th>
                <th style={{ width: 170 }}>创建时间</th>
                <th style={{ width: 160 }}></th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.username}</td>
                  <td>
                    {u.role === 'admin' ? (
                      <span className="role-badge">ADMIN</span>
                    ) : (
                      <span className="muted">member</span>
                    )}
                  </td>
                  <td className="muted">{u.created_at}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => resetPassword(u)}>
                        <KeyRound size={12} />
                        重置密码
                      </button>
                      {u.id !== currentUserId && (
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => deleteUser(u)}>
                          <Trash2 size={12} />
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users === null && (
                <tr>
                  <td colSpan={4}>
                    <div className="skeleton" style={{ height: 18 }} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form
          onSubmit={addUser}
          style={{ marginTop: 12, display: 'flex', gap: 8, maxWidth: 760, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            className="input"
            style={{ width: 170 }}
            placeholder="用户名"
            aria-label="新用户名"
            value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
          />
          <input
            className="input"
            style={{ width: 170 }}
            placeholder="密码（至少 6 位）"
            aria-label="新用户密码"
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
          />
          <select
            className="input"
            style={{ width: 110 }}
            aria-label="角色"
            value={newUser.role}
            onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button className="btn btn-primary" type="submit">
            <UserPlus size={13} />
            添加用户
          </button>
        </form>
      </section>
    </div>
  )
}
