import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/auth'
import { buildTree } from '@/lib/content/docs'
import { isRepoCloned } from '@/lib/git/git'
import { ToastProvider } from '@/components/common/Toast'
import { DialogProvider } from '@/components/common/Dialog'
import AppShell from '@/components/layout/AppShell'

export const dynamic = 'force-dynamic'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const repoReady = isRepoCloned()
  const tree = repoReady ? buildTree() : []

  return (
    <ToastProvider>
      <DialogProvider>
        <AppShell tree={tree} user={user} repoReady={repoReady}>
          {children}
        </AppShell>
      </DialogProvider>
    </ToastProvider>
  )
}
