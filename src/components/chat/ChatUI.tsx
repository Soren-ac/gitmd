'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Send, Sparkles, Square, X } from 'lucide-react'
import { copyText } from '@/lib/clipboard'
import { chatStore, useChatState } from '@/lib/client/chatStore'

interface Props {
  /** 当前页面文档（仓库相对路径）；新会话首轮会作为上下文注入 */
  contextDoc?: string | null
  /** 新会话创建后通知外层刷新会话列表 */
  onConversationCreate?: () => void
}

const SUGGESTIONS = ['平台怎么部署和配置？', 'webhook 是怎么配置的？', '批注系统是怎么实现的？']

/** 单条 AI 消息：完成后经 /api/preview 渲染为排版 HTML（复用文档渲染管线） */
function AssistantBody({ content, streaming }: { content: string; streaming: boolean }) {
  const [html, setHtml] = useState('')
  useEffect(() => {
    if (streaming || !content.trim()) return
    let alive = true
    fetch('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, docDir: '' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.html) setHtml(d.html)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [content, streaming])

  if (streaming || !html) {
    return <div className="chat-md-plain">{content}</div>
  }
  return <div className="md-body chat-md" dangerouslySetInnerHTML={{ __html: html }} />
}

/** 纯视图组件：状态全部来自共享 chatStore（悬浮窗与 /chat 页实时同步） */
export default function ChatUI({ contextDoc, onConversationCreate }: Props) {
  const router = useRouter()
  const { conversationId, messages, streaming, activity, error, convDoc } = useChatState()
  const [input, setInput] = useState('')
  const [cleared, setCleared] = useState(false) // 新会话中用户手动移除了页面文档上下文
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 登记「新会话创建」回调（两个 ChatUI 实例同时挂载时后登记生效，行为一致）
  useEffect(() => {
    chatStore.setOnCreate(onConversationCreate ?? null)
    return () => chatStore.setOnCreate(null)
  }, [onConversationCreate])

  // 会话切换时重置「手动移除上下文」（渲染期比较，避免 effect 级联）
  const [prevConvId, setPrevConvId] = useState(conversationId)
  if (prevConvId !== conversationId) {
    setPrevConvId(conversationId)
    setCleared(false)
  }

  // 当前生效的上下文文档：已有会话取其存档；新会话取当前页面文档（可被手动移除）
  const activeDoc = conversationId ? convDoc : cleared ? null : (contextDoc ?? null)

  // 新消息滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, activity])

  function send(raw: string) {
    const text = raw.trim()
    if (!text) return
    setInput('')
    void chatStore.send(text, activeDoc).then(() => inputRef.current?.focus())
  }

  /** 消息区点击委托：文档链接走站内跳转；代码块复制/折叠按钮 */
  function onBodyClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement

    const foldBtn = target.closest('.code-fold-btn, .code-expand-bar')
    if (foldBtn) {
      const figure = foldBtn.closest('figure.code-block')
      if (!figure) return
      const collapsed = figure.classList.toggle('code-collapsed')
      const headerBtn = figure.querySelector('.code-fold-btn')
      if (headerBtn) headerBtn.textContent = collapsed ? '展开' : '折叠'
      return
    }
    const copyBtn = target.closest('.copy-btn')
    if (copyBtn) {
      const text = copyBtn.closest('figure.code-block')?.querySelector('pre')?.textContent ?? ''
      copyText(text).then((ok) => {
        if (!ok) return
        copyBtn.textContent = '已复制'
        setTimeout(() => (copyBtn.textContent = '复制'), 1500)
      })
      return
    }
    const a = target.closest('a[href]') as HTMLAnchorElement | null
    if (a) {
      const href = a.getAttribute('href') ?? ''
      if (href.startsWith('/docs')) {
        e.preventDefault()
        router.push(href)
      }
    }
  }

  return (
    <div className="chat-ui">
      <div className="chat-scroll" ref={scrollRef} onClick={onBodyClick}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <Sparkles size={26} />
            <div className="chat-empty-title">我是文档库助手</div>
            <div className="chat-empty-desc">基于仓库里的文档回答，会附上来源链接。</div>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chat-suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={m.id ?? i} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">
              {m.role === 'user' ? (
                m.content
              ) : m.content ? (
                <>
                  <AssistantBody content={m.content} streaming={streaming && i === messages.length - 1} />
                  {streaming && i === messages.length - 1 && activity && (
                    <span className="chat-typing chat-typing-inline">
                      <Loader2 size={12} className="palette-spin" />
                      {activity}
                    </span>
                  )}
                </>
              ) : (
                // 首个 token 到达前：气泡内显示思考/检索状态，不出现空白气泡
                <span className="chat-typing">
                  <Loader2 size={13} className="palette-spin" />
                  {activity || '思考中…'}
                </span>
              )}
            </div>
          </div>
        ))}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-input-area">
        {activeDoc && (
          <div className="chat-context" title={`当前上下文文档：${activeDoc}`}>
            <FileText size={12} />
            <span className="chat-context-path">{activeDoc}</span>
            {!conversationId && (
              <button className="chat-context-clear" aria-label="移除上下文文档" onClick={() => setCleared(true)}>
                <X size={12} />
              </button>
            )}
          </div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            placeholder="向文档库提问…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
          />
          {streaming ? (
            <button className="btn btn-icon chat-send" onClick={() => chatStore.stop()} aria-label="停止生成" title="停止">
              <Square size={15} />
            </button>
          ) : (
            <button
              className="btn btn-icon chat-send"
              onClick={() => send(input)}
              disabled={!input.trim()}
              aria-label="发送"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
