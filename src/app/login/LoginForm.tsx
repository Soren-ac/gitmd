'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle } from 'lucide-react'

export default function LoginForm() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    setLoading(false)
    if (res.ok) {
      router.replace('/docs')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? '登录失败')
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label className="field-label" htmlFor="username" style={{ marginTop: 0 }}>
        用户名
      </label>
      <input
        id="username"
        className="input"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        autoFocus
      />
      <label className="field-label" htmlFor="password">
        密码
      </label>
      <input
        id="password"
        className="input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && (
        <p className="error-text">
          <AlertCircle size={13} />
          {error}
        </p>
      )}
      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 20, height: 36 }}
        disabled={loading}
      >
        {loading ? '登录中…' : '登录'}
      </button>
    </form>
  )
}
