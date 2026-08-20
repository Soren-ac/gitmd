import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/auth'
import ChatPage from '@/components/chat/ChatPage'

export const dynamic = 'force-dynamic'

export default async function Chat() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=' + encodeURIComponent('/chat'))
  return <ChatPage />
}
