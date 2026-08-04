'use client'

import { useEffect, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

interface Props {
  initialValue: string
  /** 文档所在目录（仓库相对，posix），用于解析相对图片路径 */
  docDir: string
  onChange: (markdown: string) => void
  /** 上传进度/结果通知（接编辑器状态栏） */
  onNotify?: (message: string, tone?: 'ok' | 'err' | 'info') => void
}

/** posix 路径拼接与归一化（客户端无 node:path） */
function joinPosix(dir: string, rel: string): string {
  const parts: string[] = []
  for (const seg of `${dir}/${rel}`.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/** 与渲染管线同规则：文档内的仓库相对图片路径 → 平台资源 URL（仅用于编辑器 DOM 显示） */
function proxyAssetUrl(docDir: string, src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:') || src.startsWith('/api/')) return src
  let decoded = src
  try {
    decoded = decodeURIComponent(src)
  } catch {
    // 畸形编码保留原样
  }
  const joined = decoded.startsWith('/') ? decoded.slice(1) : joinPosix(docDir, decoded)
  return '/api/assets/' + joined.split('/').map(encodeURIComponent).join('/')
}

/** Milkdown Crepe WYSIWYG 封装。只在挂载时用 initialValue 初始化，后续通过 onChange 回传。 */
export default function Wysiwyg({ initialValue, docDir, onChange, onNotify }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onChangeRef = useRef(onChange)
  const onNotifyRef = useRef(onNotify)
  useEffect(() => {
    onChangeRef.current = onChange
    onNotifyRef.current = onNotify
  }, [onChange, onNotify])

  useEffect(() => {
    if (!rootRef.current) return
    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: initialValue,
      featureConfigs: {
        [Crepe.Feature.ImageBlock]: {
          // 粘贴/拖拽/选择图片 → 写入仓库 assets/ 并提交推送；文档中存仓库根相对路径，保持仓库可移植
          onUpload: async (file: File) => {
            onNotifyRef.current?.(`上传图片 ${file.name}…`, 'info')
            const form = new FormData()
            form.append('file', file)
            const res = await fetch('/api/assets', { method: 'POST', body: form })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
              onNotifyRef.current?.(`图片上传失败：${data.error ?? res.status}`, 'err')
              throw new Error(data.error ?? '上传失败')
            }
            onNotifyRef.current?.('图片已上传并提交', 'ok')
            return String(data.path)
          },
          // 文档里是仓库相对路径，编辑器 DOM 里走平台资源接口显示
          proxyDomURL: (url: string) => proxyAssetUrl(docDir, url),
        },
      },
    })
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
