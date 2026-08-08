'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { History, Maximize2, MessageSquarePlus, Sparkles, Trash2, X } from 'lucide-react'
import ChatUI from '@/components/chat/ChatUI'

interface ConvItem {
  id: string
  title: string
  updatedAt: string
}

/** AI 对话入口：右下角悬浮按钮 + 抽屉面板；未配置 AI 时不渲染 */
export default function ChatWidget() {
  const router = useRouter()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [convs, setConvs] = useState<ConvItem[]>([])

  useEffect(() => {
    fetch('/api/chat/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(Boolean(d?.enabled)))
      .catch(() => {})
  }, [])

  const loadConvs = useCallback(() => {
    fetch('/api/chat/conversations')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConvs(d?.conversations ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (listOpen) loadConvs()
  }, [listOpen, loadConvs])

  if (!enabled) return null

  function newChat() {
    setConversationId(null)
    setListOpen(false)
  }

  async function removeConv(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' })
    if (conversationId === id) setConversationId(null)
    loadConvs()
  }

  return (
    <>
      {open && (
        <div className="chat-drawer">
          <div className="chat-head">
            <span className="chat-head-title">
              <Sparkles size={14} />
              文档助手
            </span>
            <button
              className={`btn btn-icon ${listOpen ? 'active' : ''}`}
              aria-label="会话列表"
              title="会话列表"
              onClick={() => setListOpen((v) => !v)}
            >
              <History size={15} />
            </button>
            <button className="btn btn-icon" aria-label="新对话" title="新对话" onClick={newChat}>
              <MessageSquarePlus size={15} />
            </button>
            <button
              className="btn btn-icon"
              aria-label="打开完整页面"
              title="打开完整页面"
              onClick={() => router.push('/chat')}
            >
              <Maximize2 size={15} />
            </button>
            <button className="btn btn-icon" aria-label="关闭" onClick={() => setOpen(false)}>
              <X size={15} />
            </button>
          </div>
          {listOpen && (
            <div className="chat-conv-list">
              {convs.length === 0 && <div className="chat-conv-empty">暂无历史会话</div>}
              {convs.map((c) => (
                <button
                  key={c.id}
                  className={`chat-conv-item ${c.id === conversationId ? 'active' : ''}`}
                  onClick={() => {
                    setConversationId(c.id)
                    setListOpen(false)
                  }}
                >
                  <span className="chat-conv-title">{c.title}</span>
                  <span className="chat-conv-del" role="button" aria-label="删除会话" onClick={(e) => removeConv(e, c.id)}>
                    <Trash2 size={13} />
                  </span>
                </button>
              ))}
            </div>
          )}
          <ChatUI
            conversationId={conversationId}
            onConversationChange={setConversationId}
            onConversationCreate={loadConvs}
          />
        </div>
      )}
      <button
        className={`chat-fab ${open ? 'open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '关闭文档助手' : '打开文档助手'}
        title="文档助手"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
      </button>
    </>
  )
}
