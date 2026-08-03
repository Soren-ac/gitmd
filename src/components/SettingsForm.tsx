'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, GitCommitHorizontal, Save } from 'lucide-react'
import { useToast } from '@/components/Toast'

interface Props {
  initialName: string
  initialEmail: string
  next: string
}

export default function SettingsForm({ initialName, initialEmail, next }: Props) {
  const router = useRouter()
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gitName: name, gitEmail: email }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) {
      setError(data.error ?? '保存失败')
      return
    }
    toast.push('success', 'Git 用户信息已保存')
    if (next) {
      router.push(next)
      router.refresh()
    }
  }

  return (
    <div>
      {next && (
        <div className="callout callout-note" style={{ marginTop: 0 }}>
          <p className="callout-title">
            <CircleAlert size={14} />
            需要先设置 Git 用户信息
          </p>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            编辑文档会以你的身份产生 git 提交，请先填写用于提交记录的用户名和邮箱。
          </p>
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <GitCommitHorizontal size={16} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Git 提交身份</span>
        </div>
        <p className="muted" style={{ margin: '0 0 8px' }}>
          保存文档时，提交记录的 author 将使用这里的用户名和邮箱（committer 为平台 bot）。
        </p>
        <form onSubmit={onSubmit}>
          <label className="field-label" htmlFor="git-name">
            用户名
          </label>
          <input
            id="git-name"
            className="input"
            placeholder="如 zhangsan"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
          <label className="field-label" htmlFor="git-email">
            邮箱
          </label>
          <input
            id="git-email"
            className="input"
            type="email"
            placeholder="如 zhangsan@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {error && <p className="error-text">{error}</p>}
          <button
            className="btn btn-primary"
            type="submit"
            style={{ marginTop: 20 }}
            disabled={saving || !name.trim() || !email.trim()}
          >
            <Save size={13} />
            {saving ? '保存中…' : '保存设置'}
          </button>
        </form>
      </div>
    </div>
  )
}
