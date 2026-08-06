'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Dices, KeyRound, RefreshCw, Trash2, UserPlus, Users, Database, Webhook } from 'lucide-react'
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

interface WebhookInfo {
  secret: string
  source: 'db' | 'env' | 'none'
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
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null)
  const [secretInput, setSecretInput] = useState('')
  const [savingSecret, setSavingSecret] = useState(false)
  const [copied, setCopied] = useState<'url' | 'secret' | null>(null)
  // 仅在 webhook 数据加载后（客户端）才渲染 URL，SSR/水合输出一致，无 mismatch
  const [origin] = useState(() => (typeof window === 'undefined' ? '' : window.location.origin))

  async function load() {
    const [s, u, c] = await Promise.all([fetch('/api/sync'), fetch('/api/admin/users'), fetch('/api/admin/config')])
    if (s.ok) setSync(await s.json())
    if (u.ok) setUsers((await u.json()).users)
    if (c.ok) setWebhook((await c.json()).webhook)
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步加载完成后才 setState
    load()
  }, [])

  async function copyText(text: string, which: 'url' | 'secret') {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(which)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      toast.push('error', '复制失败，请手动选择复制')
    }
  }

  async function saveSecret(e: React.FormEvent) {
    e.preventDefault()
    if (savingSecret) return
    setSavingSecret(true)
    const res = await fetch('/api/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ webhookSecret: secretInput }),
    })
    const data = await res.json().catch(() => ({}))
    setSavingSecret(false)
    if (res.ok) {
      setWebhook(data.webhook)
      setSecretInput('')
      toast.push('success', data.webhook.secret ? 'Webhook 密钥已保存' : '已清除界面配置，回退到环境变量')
    } else {
      toast.push('error', data.error ?? '保存失败')
    }
  }

  async function generateSecret() {
    const ok = await dialog.confirm({
      title: '随机生成密钥',
      message: '生成后旧密钥立即失效，CodeHub 侧的 webhook URL 需要同步更新。继续？',
      confirmText: '生成并替换',
    })
    if (!ok) return
    const res = await fetch('/api/admin/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate' }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setWebhook(data.webhook)
      toast.push('success', '已生成新密钥')
    } else {
      toast.push('error', data.error ?? '生成失败')
    }
  }

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
          <Webhook size={16} style={{ color: 'var(--text-tertiary)' }} />
          Webhook
        </h2>
        <div className="card" style={{ maxWidth: 760, padding: '14px 16px' }}>
          {!webhook ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 18, width: `${85 - i * 20}%` }} />
              ))}
            </div>
          ) : (
            <>
              <table className="admin-table">
                <tbody>
                  <InfoRow label="状态">
                    {webhook.source === 'none' ? (
                      <span className="status-dot err">未配置</span>
                    ) : (
                      <span className="status-dot ok">{webhook.source === 'db' ? '界面配置生效中' : '环境变量生效中'}</span>
                    )}
                  </InfoRow>
                  <InfoRow label="Webhook URL">
                    {webhook.secret ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                          {origin}/api/webhook?token={webhook.secret}
                        </code>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => copyText(`${origin}/api/webhook?token=${webhook.secret}`, 'url')}
                        >
                          {copied === 'url' ? <Check size={12} /> : <Copy size={12} />}
                          {copied === 'url' ? '已复制' : '复制'}
                        </button>
                      </div>
                    ) : (
                      <span className="muted">配置密钥后生成</span>
                    )}
                  </InfoRow>
                  <InfoRow label="密钥">
                    {webhook.secret ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <code className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>{webhook.secret}</code>
                        <button className="btn btn-sm btn-ghost" onClick={() => copyText(webhook.secret, 'secret')}>
                          {copied === 'secret' ? <Check size={12} /> : <Copy size={12} />}
                          {copied === 'secret' ? '已复制' : '复制'}
                        </button>
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </InfoRow>
                </tbody>
              </table>

              <form onSubmit={saveSecret} style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input
                  className="input mono"
                  style={{ flex: 1, minWidth: 240, fontSize: 12.5 }}
                  placeholder="自定义密钥（至少 16 个字符）"
                  aria-label="webhook 密钥"
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                />
                <button className="btn" type="submit" disabled={savingSecret || !secretInput.trim()}>
                  {savingSecret ? <span className="spinner" /> : <Check size={13} />}
                  保存
                </button>
                <button className="btn btn-ghost" type="button" onClick={generateSecret}>
                  <Dices size={13} />
                  随机生成
                </button>
                {webhook.source === 'db' && (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    title="清除界面配置，回退到 WEBHOOK_SECRET 环境变量"
                    onClick={async () => {
                      const res = await fetch('/api/admin/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ webhookSecret: '' }),
                      })
                      const data = await res.json().catch(() => ({}))
                      if (res.ok) {
                        setWebhook(data.webhook)
                        toast.push('success', '已回退到环境变量配置')
                      }
                    }}
                  >
                    回退到环境变量
                  </button>
                )}
              </form>
              <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0, lineHeight: 1.7 }}>
                把上面的 URL 配到 CodeHub：仓库 Settings → Webhooks → 事件勾选 Push。
                界面配置的密钥优先于 WEBHOOK_SECRET 环境变量；更换密钥后需同步更新 CodeHub 侧。
              </p>
            </>
          )}
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
