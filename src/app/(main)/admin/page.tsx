import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/auth'
import AdminPanel from '@/components/admin/AdminPanel'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const user = await getSessionUser()
  if (user?.role !== 'admin') redirect('/docs')
  return (
    <div className="doc-container">
      <div className="page-head">
        <h1>平台管理</h1>
      </div>
      <AdminPanel currentUserId={user.id} />
    </div>
  )
}
