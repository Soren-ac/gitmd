import { getSessionUser } from '@/lib/auth/auth'
import { getDocTree } from '@/lib/content/docs'
import { isRepoCloned } from '@/lib/git/git'
import { ToastProvider } from '@/components/common/Toast'
import { DialogProvider } from '@/components/common/Dialog'
import AppShell from '@/components/layout/AppShell'

export const dynamic = 'force-dynamic'

// 只读内容（文档/搜索/历史/批注查看）匿名可访问；写操作由各页面与 API 自行校验登录态
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()

  const repoReady = isRepoCloned()
  const tree = repoReady ? getDocTree() : []

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
