'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Loader2, Send, Sparkles, Square, X } from 'lucide-react'
import { copyText } from '@/lib/clipboard'

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  conversationId: string | null
  onConversationChange: (id: string | null) => void
  /** 新会话创建后通知外层刷新会话列表 */
  onConversationCreate?: () => void
  /** 当前页面文档（仓库相对路径）；新会话首轮会作为上下文注入 */
  contextDoc?: string | null
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

export default function ChatUI({ conversationId, onConversationChange, onConversationCreate, contextDoc }: Props) {
  const router = useRouter()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activity, setActivity] = useState('')
  const [error, setError] = useState('')
  const [convDoc, setConvDoc] = useState<string | null>(null) // 已存会话的上下文文档
  const [cleared, setCleared] = useState(false) // 新会话中用户手动移除了页面文档上下文
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 切换会话：渲染期重置（避免 effect 级联），effect 里只异步加载
  const [prevConvId, setPrevConvId] = useState(conversationId)
  if (prevConvId !== conversationId) {
    setPrevConvId(conversationId)
    setConvDoc(null)
    setCleared(false)
    // 流式进行中不重置：新会话收到 meta 后 conversationId 从 null 变为新 id，
    // 此时清空会丢掉助手占位消息，后续 delta 无处可追加
    if (!streaming) {
      setMessages([])
      setError('')
    }
  }

  // 当前生效的上下文文档：已有会话取其存档；新会话取当前页面文档（可被手动移除）
  const activeDoc = conversationId ? convDoc : cleared ? null : (contextDoc ?? null)

  useEffect(() => {
    // 流式进行中不拉历史：流结束后 streaming 变 false 会重新触发本 effect，
    // 届时数据库已持久化完整问答，再整体替换为权威历史
    if (!conversationId || streaming) return
    let alive = true
    fetch(`/api/chat/conversations/${conversationId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return
        if (d.messages) setMessages(d.messages)
        setConvDoc(d.conversation?.docPath ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [conversationId, streaming])

  // 新消息滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, activity])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || streaming) return
      setError('')
      setInput('')
      setStreaming(true)
      setActivity('思考中…')
      setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }])

      const abort = new AbortController()
      abortRef.current = abort
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            message: text,
            // 新会话携带上下文文档；已有会话的上下文在会话存档里
            ...(!conversationId && activeDoc ? { docPath: activeDoc } : {}),
          }),
          signal: abort.signal,
        })
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error ?? '请求失败')
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            const ev = JSON.parse(line)
            if (ev.type === 'meta') {
              if (!conversationId) {
                onConversationChange(ev.conversationId)
                onConversationCreate?.()
              }
            } else if (ev.type === 'activity') {
              setActivity(ev.text)
            } else if (ev.type === 'delta') {
              setActivity('')
              setMessages((m) => {
                const next = [...m]
                const last = next[next.length - 1]
                if (last?.role === 'assistant') {
                  // 逐 token 追加；仅在新文本块开头补块间分隔
                  const sep = ev.newBlock && last.content ? '\n\n' : ''
                  next[next.length - 1] = { ...last, content: last.content + sep + ev.text }
                }
                return next
              })
            } else if (ev.type === 'error') {
              throw new Error(ev.error)
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) {
          // 用户主动停止：保留已生成内容
        } else {
          const msg = err instanceof Error ? err.message : '对话失败'
          setError(msg)
          // 去掉空的助手占位消息
          setMessages((m) => (m[m.length - 1]?.role === 'assistant' && !m[m.length - 1].content ? m.slice(0, -1) : m))
        }
      } finally {
        setStreaming(false)
        setActivity('')
        abortRef.current = null
        inputRef.current?.focus()
      }
    },
    [conversationId, streaming, activeDoc, onConversationChange, onConversationCreate],
  )

  function stop() {
    abortRef.current?.abort()
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
            <button className="btn btn-icon chat-send" onClick={stop} aria-label="停止生成" title="停止">
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
