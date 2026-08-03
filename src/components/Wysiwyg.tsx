'use client'

import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

interface Props {
  initialValue: string
  onChange: (markdown: string) => void
}

/** Milkdown Crepe WYSIWYG 封装。只在挂载时用 initialValue 初始化，后续通过 onChange 回传。 */
export default function Wysiwyg({ initialValue, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!rootRef.current) return
    const crepe = new Crepe({ root: rootRef.current, defaultValue: initialValue })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => {
        onChangeRef.current(markdown)
      })
    })
    let alive = true
    crepe
      .create()
      .then(() => {
        if (!alive) crepe.destroy().catch(() => {})
      })
      .catch((e) => console.error('milkdown 初始化失败', e))
    return () => {
      alive = false
      crepe.destroy().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div ref={rootRef} className="milkdown" />
}
