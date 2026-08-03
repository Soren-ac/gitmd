import { getSessionUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import SettingsForm from '@/components/SettingsForm'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ next?: string }>
}

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const { next } = await searchParams

  return (
    <div className="doc-container" style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1>个人设置</h1>
      </div>
      <SettingsForm
        initialName={user.git_name ?? ''}
        initialEmail={user.git_email ?? ''}
        next={next ?? ''}
      />
    </div>
  )
}
