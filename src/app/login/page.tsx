import { redirect } from 'next/navigation'
import { GitBranch } from 'lucide-react'
import { getSessionUser } from '@/lib/auth/auth'
import LoginForm from './LoginForm'

/** 登录后回跳目标：仅接受站内相对路径，防开放式跳转 */
function safeNext(raw: string | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return ''
  return raw
}

interface Props {
  searchParams: Promise<{ next?: string }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams
  const target = safeNext(next)
  const user = await getSessionUser()
  if (user) redirect(target || '/docs')
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
        <LoginForm next={target} />
      </div>
    </div>
  )
}
