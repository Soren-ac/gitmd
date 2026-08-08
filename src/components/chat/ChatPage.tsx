'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react'
import ChatUI from '@/components/chat/ChatUI'

interface ConvItem {
  id: string
  title: string
  updatedAt: string
}

/** /chat 独立页面：左列会话列表 + 右侧对话区 */
export default function ChatPage() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [convs, setConvs] = useState<ConvItem[]>([])

  const loadConvs = useCallback(() => {
    fetch('/api/chat/conversations')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConvs(d?.conversations ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadConvs()
  }, [loadConvs])

  async function removeConv(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
    if (conversationId === id) setConversationId(null)
    loadConvs()
  }

  return (
    <div className="chat-page">
      <aside className="chat-page-side">
        <button className="btn btn-primary chat-new-btn" onClick={() => setConversationId(null)}>
          <MessageSquarePlus size={14} />
          新对话
        </button>
        <div className="chat-page-convs">
          {convs.length === 0 && <div className="chat-conv-empty">暂无历史会话</div>}
          {convs.map((c) => (
            <button
              key={c.id}
              className={`chat-conv-item ${c.id === conversationId ? 'active' : ''}`}
              onClick={() => setConversationId(c.id)}
            >
              <span className="chat-conv-title">{c.title}</span>
              <span className="chat-conv-del" role="button" aria-label="删除会话" onClick={(e) => removeConv(e, c.id)}>
                <Trash2 size={13} />
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="chat-page-main">
        <div className="chat-page-head">
          <Sparkles size={15} />
          文档助手
          <span className="muted" style={{ fontWeight: 400 }}>基于文档仓库回答，附来源链接</span>
        </div>
        <ChatUI
          conversationId={conversationId}
          onConversationChange={setConversationId}
          onConversationCreate={loadConvs}
          contextDoc={null}
        />
      </div>
    </div>
  )
}
