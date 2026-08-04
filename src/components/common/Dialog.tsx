'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

interface DialogOptions {
  title: string
  message?: string
  /** 有 input 时是输入对话框，resolve 字符串；否则是确认框，resolve boolean */
  input?: { placeholder?: string; defaultValue?: string }
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

interface DialogState extends DialogOptions {
  resolve: (value: string | boolean | null) => void
}

const DialogContext = createContext<{
  confirm: (opts: DialogOptions) => Promise<boolean>
  prompt: (opts: DialogOptions) => Promise<string | null>
}>({
  confirm: async () => false,
  prompt: async () => null,
})

export function useDialog() {
  return useContext(DialogContext)
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const open = useCallback((opts: DialogOptions) => {
    return new Promise<string | boolean | null>((resolve) => {
      setValue(opts.input?.defaultValue ?? '')
      setState({ ...opts, resolve })
    })
  }, [])

  const confirm = useCallback(
    async (opts: DialogOptions) => (await open(opts)) === true,
    [open],
  )
  const prompt = useCallback(
    async (opts: DialogOptions) => {
      const r = await open({ ...opts, input: opts.input ?? {} })
      return typeof r === 'string' && r.trim() ? r.trim() : null
    },
    [open],
  )

  const close = useCallback(
    (result: string | boolean | null) => {
      state?.resolve(result)
      setState(null)
    },
    [state],
  )

  useEffect(() => {
    if (state?.input) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [state])

  function submit() {
    if (!state) return
    if (state.input) close(value.trim() || null)
    else close(true)
  }

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {state && (
        <div className="dialog-overlay" onClick={() => close(null)}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={state.title}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close(null)
              if (e.key === 'Enter') submit()
            }}
          >
            <div className="dialog-title">{state.title}</div>
            {state.message && <div className="dialog-message">{state.message}</div>}
            {state.input && (
              <input
                ref={inputRef}
                className="input"
                style={{ marginTop: 4 }}
                placeholder={state.input.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
            <div className="dialog-actions">
              <button className="btn" onClick={() => close(null)}>
                {state.cancelText ?? '取消'}
              </button>
              <button
                className={`btn ${state.danger ? 'btn-danger-solid' : 'btn-primary'}`}
                onClick={submit}
                autoFocus={!state.input}
              >
                {state.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}
