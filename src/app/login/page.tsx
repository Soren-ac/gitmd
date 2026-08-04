import { redirect } from 'next/navigation'
import { GitBranch } from 'lucide-react'
import { getSessionUser } from '@/lib/auth/auth'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  const user = await getSessionUser()
  if (user) redirect('/docs')
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">
          <span className="logo-mark">
            <GitBranch size={14} />
          </span>
          GitMD
        </div>
        <p className="login-subtitle">团队文档平台 · 登录以继续</p>
        <LoginForm />
      </div>
    </div>
  )
}
