import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/auth'
import AnnotationsCenter from '@/components/annotations/AnnotationsCenter'

export const dynamic = 'force-dynamic'

export default async function AnnotationsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=' + encodeURIComponent('/annotations'))
  return <AnnotationsCenter />
}
