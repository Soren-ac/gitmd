'use client'

import { useSyncExternalStore } from 'react'

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant'
  content: string
}

export interface ChatState {
  conversationId: string | null
  messages: ChatMessage[]
  streaming: boolean
  activity: string
  error: string
  /** 已存会话的上下文文档（历史接口返回） */
  convDoc: string | null
}

/* 模块级单例：右下角悬浮窗与 /chat 全屏页共享同一份会话状态。
 * 流式请求由本模块发起并持有，组件卸载、抽屉关闭、页面切换都不打断进度——
 * 悬浮窗流式问答中打开全屏页能直接接上，悬浮窗可随即关闭。 */
let state: ChatState = {
  conversationId: null,
  messages: [],
  streaming: false,
  activity: '',
  error: '',
  convDoc: null,
}

const listeners = new Set<() => void>()
let abortRef: AbortController | null = null
/** 新会话创建后的回调（外层刷新会话列表），任一 ChatUI 挂载时登记 */
let onCreate: (() => void) | null = null

function set(partial: Partial<ChatState>) {
  state = { ...state, ...partial }
  for (const l of listeners) l()
}

export function useChatState(): ChatState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}

/** 拉取会话权威历史（选择会话 / 流式结束后对齐服务端持久化结果） */
async function loadHistory(id: string) {
  try {
    const r = await fetch(`/api/chat/conversations/${id}`)
    const d = r.ok ? await r.json() : null
    if (!d || state.conversationId !== id) return
    if (d.messages) set({ messages: d.messages })
    set({ convDoc: d.conversation?.docPath ?? null })
  } catch {
    // 历史加载失败保持现状
  }
}

export const chatStore = {
  setOnCreate(cb: (() => void) | null) {
    onCreate = cb
  },

  /** 切换会话；流式进行中忽略（占位消息属于进行中的流，同原 ChatUI 语义） */
  selectConversation(id: string | null) {
    if (state.streaming || id === state.conversationId) return
    set({ conversationId: id, messages: [], error: '', convDoc: null, activity: '' })
    if (id) void loadHistory(id)
  },

  /** 发起一轮对话；docPath 仅新会话首轮注入（调用方按当前页面计算） */
  async send(text: string, docPath: string | null) {
    const trimmed = text.trim()
    if (!trimmed || state.streaming) return
    const isNew = !state.conversationId
    set({
      error: '',
      streaming: true,
      activity: '思考中…',
      messages: [...state.messages, { role: 'user', content: trimmed }, { role: 'assistant', content: '' }],
    })
    const abort = new AbortController()
    abortRef = abort
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: state.conversationId,
          message: trimmed,
          ...(isNew && docPath ? { docPath } : {}),
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
            if (isNew) {
              set({ conversationId: ev.conversationId })
              onCreate?.()
            }
          } else if (ev.type === 'activity') {
            set({ activity: ev.text })
          } else if (ev.type === 'delta') {
            const msgs = [...state.messages]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant') {
              // 块边界补分隔时归一化（与服务端 append 一致）：剥掉尾部/块首换行，
              // 防止模型自带行尾换行与 \n\n 分隔叠加成越来越多的空白行
              let content = last.content
              let text = ev.text as string
              if (ev.newBlock && content) {
                const body = text.replace(/^\n+/, '')
                content = content.replace(/\n+$/, '')
                text = body ? '\n\n' + body : ''
              }
              msgs[msgs.length - 1] = { ...last, content: content + text }
              set({ messages: msgs, activity: '' })
            }
          } else if (ev.type === 'error') {
            throw new Error(ev.error)
          }
        }
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        // 用户主动停止时静默保留已生成内容；其他错误去掉空的助手占位消息
        const msgs = state.messages
        set({
          error: err instanceof Error ? err.message : '对话失败',
          messages:
            msgs[msgs.length - 1]?.role === 'assistant' && !msgs[msgs.length - 1].content
              ? msgs.slice(0, -1)
              : msgs,
        })
      }
    } finally {
      set({ streaming: false, activity: '' })
      abortRef = null
      // 服务端已持久化完整问答，对齐为权威历史（含消息 id）
      const id = state.conversationId
      if (id) await loadHistory(id)
    }
  },

  stop() {
    abortRef?.abort()
  },
}
