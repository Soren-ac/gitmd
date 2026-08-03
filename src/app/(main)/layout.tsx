import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { buildTree } from '@/lib/docs'
import { isRepoCloned } from '@/lib/git'
import { ToastProvider } from '@/components/Toast'
import { DialogProvider } from '@/components/Dialog'
import AppShell from '@/components/AppShell'

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
