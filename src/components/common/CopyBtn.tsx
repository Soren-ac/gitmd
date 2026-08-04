'use client'

import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** 代码块复制按钮：向上找到所在 figure 的 pre 文本复制 */
export default function CopyBtn() {
  const ref = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    const figure = ref.current?.closest('figure.code-block')
    const text = figure?.querySelector('pre')?.innerText ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默
    }
  }

  return (
    <button ref={ref} className="copy-btn" onClick={copy} aria-label="复制代码">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? '已复制' : '复制'}
    </button>
  )
}
