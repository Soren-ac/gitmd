'use client'

import { useRef, useState } from 'react'
import { FoldVertical, UnfoldVertical } from 'lucide-react'

/**
 * 代码块折叠控制（RSC 渲染管线中 code-fold 自定义元素的实现）。
 * 初始状态由服务端打在 figure 上的 code-collapsed 类决定（默认折叠）。
 * 头部小按钮常驻；底部悬浮展开条仅折叠时渲染。
 */
export default function CodeFold({ lines }: { lines: number }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  function toggle() {
    const next = !open
    const figure = btnRef.current?.closest('figure.code-block')
    figure?.classList.toggle('code-collapsed', !next)
    setOpen(next)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="code-fold-btn"
        onClick={toggle}
        aria-label={open ? '折叠代码块' : '展开代码块'}
        title={open ? '折叠' : `展开（共 ${lines} 行）`}
      >
        {open ? <FoldVertical size={12} /> : <UnfoldVertical size={12} />}
        {open ? '折叠' : `${lines} 行`}
      </button>
      {!open && (
        <button type="button" className="code-expand-bar" onClick={toggle}>
          <UnfoldVertical size={13} />
          展开全部（{lines} 行）
        </button>
      )}
    </>
  )
}
