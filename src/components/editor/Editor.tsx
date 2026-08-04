'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'
import {
  ArrowLeft,
  Check,
  Code2,
  Columns2,
  Eye,
  FileText,
  PenLine,
  Save,
  Sigma,
  SquareChartGantt,
} from 'lucide-react'
import { joinFrontmatter } from '@/lib/markdown/frontmatter'
import { hydrateMermaidBlocks } from '@/components/docs/Mermaid'
import { useDialog } from '@/components/common/Dialog'
import Wysiwyg from '@/components/editor/Wysiwyg'

interface Props {
  path: string // 仓库相对路径，含 .md
  docDir: string
  initialFrontmatter: string
  initialBody: string
  initialHash: string
  isNew: boolean
}

type Mode = 'source' | 'wysiwyg'
type View = 'edit' | 'split' | 'preview'

export default function Editor({ path, docDir, initialFrontmatter, initialBody, initialHash, isNew }: Props) {
  const router = useRouter()
  const dialog = useDialog()
  const [frontmatter, setFrontmatter] = useState(initialFrontmatter)
  const [body, setBody] = useState(initialBody)
  const [hash, setHash] = useState(initialHash)
  const [mode, setMode] = useState<Mode>('source')
  const [view, setView] = useState<View>('split')
  const [previewHtml, setPreviewHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'ok' | 'err' | 'info'>('info')
  const [commitMsg, setCommitMsg] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const bodyRef = useRef(body)
  const fmRef = useRef(frontmatter)
  const msgRef = useRef(commitMsg)
  useEffect(() => {
    bodyRef.current = body
  }, [body])
  useEffect(() => {
    fmRef.current = frontmatter
  }, [frontmatter])
  useEffect(() => {
    msgRef.current = commitMsg
  }, [commitMsg])

  // ------- 未保存修改提醒 -------
  // 保存成功后的内容基线；dirty = 当前内容与基线不一致
  const [saved, setSaved] = useState({ body: initialBody, fm: initialFrontmatter })
  const dirty = body !== saved.body || frontmatter !== saved.fm
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  // 关闭/刷新页面前提醒
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // 站内链接导航拦截（含「返回」按钮与顶栏链接）
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!dirtyRef.current || e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement).closest?.('a[href]') as HTMLAnchorElement | null
      if (!a) return
      const href = a.getAttribute('href') ?? ''
      if (!href.startsWith('/')) return
      e.preventDefault()
      e.stopPropagation()
      void dialog
        .confirm({
          title: '离开编辑器？',
          message: '有未保存的修改，离开后未保存的内容将丢失。',
          confirmText: '放弃修改并离开',
          danger: true,
        })
        .then((leave) => {
          if (leave) router.push(href)
        })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dialog, router])

  // ------- 实时预览（防抖） -------
  useEffect(() => {
    if (mode !== 'source' || view === 'edit') return
    const timer = setTimeout(async () => {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body, docDir }),
      })
      if (res.ok) {
        const { html } = await res.json()
        setPreviewHtml(html)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [body, view, mode, docDir])

  useEffect(() => {
    if (previewRef.current && previewHtml) {
      hydrateMermaidBlocks(previewRef.current).catch(() => {})
    }
  }, [previewHtml])

  // ------- 保存 -------
  const save = useCallback(async () => {
    if (saving) return
    setSaving(true)
    setStatus('保存中…')
    setStatusTone('info')
    const content = joinFrontmatter(fmRef.current, bodyRef.current)
    const message = msgRef.current.trim() || undefined
    const attempt = async (baseHash: string) =>
      fetch('/api/docs/' + path.split('/').map(encodeURIComponent).join('/'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, baseHash, message }),
      })

    try {
      let res = await attempt(hash)
      if (res.status === 409) {
        const data = await res.json()
        const overwrite = await dialog.confirm({
          title: '保存冲突',
          message:
            '该文档在你编辑期间已被他人修改。\n\n「覆盖远端」将以你的内容为准；「取消」保留编辑器内容，你可以先复制保存再手动合并。',
          confirmText: '覆盖远端',
          danger: true,
        })
        if (!overwrite) {
          setStatus('已取消保存')
          setStatusTone('info')
          setSaving(false)
          return
        }
        res = await attempt(data.currentHash ?? '')
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '保存失败')
      setHash(data.hash)
      setSaved({ body: bodyRef.current, fm: fmRef.current })
      setCommitMsg('')
      setStatus('已保存并推送')
      setStatusTone('ok')
      router.refresh()
    } catch (err) {
      setStatus('保存失败：' + (err instanceof Error ? err.message : String(err)))
      setStatusTone('err')
    } finally {
      setSaving(false)
    }
  }, [hash, path, saving, router, dialog])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  // ------- 图片粘贴/拖拽上传 -------
  async function uploadFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      setStatus(`上传图片 ${file.name}…`)
      setStatusTone('info')
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/assets', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus('图片上传失败：' + (data.error ?? ''))
        setStatusTone('err')
        continue
      }
      insertSnippet(`![${file.name}](${data.path})`)
      setStatus('图片已上传并提交')
      setStatusTone('ok')
    }
  }

  function insertSnippet(snippet: string) {
    const view = viewRef.current
    if (view) {
      view.dispatch(view.state.replaceSelection(snippet))
      view.focus()
    } else {
      setBody((b) => b + snippet)
    }
  }

  // 预览面板里代码块复制按钮（HTML 预览模式下的事件委托）
  function onPreviewClick(e: React.MouseEvent) {
    const btn = (e.target as HTMLElement).closest('.copy-btn')
    if (!btn) return
    const text = btn.closest('figure.code-block')?.querySelector('pre')?.textContent ?? ''
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '已复制'
      setTimeout(() => (btn.textContent = '复制'), 1500)
    })
  }

  const docHref = '/docs/' + path.replace(/\.mdx?$/i, '').split('/').map(encodeURIComponent).join('/')
  const showEditorPane = view !== 'preview'
  const showPreviewPane = mode === 'source' && view !== 'edit'

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <Link className="btn btn-ghost btn-sm" href={docHref} aria-label="返回文档">
          <ArrowLeft size={14} />
          返回
        </Link>
        <span className="editor-path">
          <FileText size={13} />
          {path}
          {isNew && <span className="role-badge">新建</span>}
        </span>
        <span className="spacer" />

        {mode === 'source' && (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => insertSnippet('\n```mermaid\ngraph LR\n  A --> B\n```\n')}
              title="插入 Mermaid 图"
            >
              <SquareChartGantt size={13} />
              图表
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => insertSnippet('\n$$\nE = mc^2\n$$\n')}
              title="插入块级公式"
            >
              <Sigma size={13} />
              公式
            </button>
          </>
        )}

        <div className="segmented" role="tablist" aria-label="编辑模式">
          <button
            role="tab"
            aria-selected={mode === 'source'}
            className={mode === 'source' ? 'active' : ''}
            onClick={() => setMode('source')}
          >
            <Code2 size={13} />
            源码
          </button>
          <button
            role="tab"
            aria-selected={mode === 'wysiwyg'}
            className={mode === 'wysiwyg' ? 'active' : ''}
            onClick={() => setMode('wysiwyg')}
            title="所见即所得模式（mermaid/数学公式等扩展语法以代码块形式保留）"
          >
            <PenLine size={13} />
            所见即所得
          </button>
        </div>

        {mode === 'source' && (
          <div className="segmented" role="tablist" aria-label="视图">
            <button
              role="tab"
              aria-selected={view === 'edit'}
              className={view === 'edit' ? 'active' : ''}
              onClick={() => setView('edit')}
              title="仅编辑"
            >
              <Code2 size={13} />
            </button>
            <button
              role="tab"
              aria-selected={view === 'split'}
              className={view === 'split' ? 'active' : ''}
              onClick={() => setView('split')}
              title="分屏"
            >
              <Columns2 size={13} />
            </button>
            <button
              role="tab"
              aria-selected={view === 'preview'}
              className={view === 'preview' ? 'active' : ''}
              onClick={() => setView('preview')}
              title="仅预览"
            >
              <Eye size={13} />
            </button>
          </div>
        )}

        <input
          className="input commit-msg-input"
          placeholder={`提交说明（可选，默认 docs: update ${path}）`}
          aria-label="提交说明"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
          {saving ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : <Save size={13} />}
          {saving ? '保存中' : '保存'}
        </button>
        {status && (
          <span className={`editor-status ${statusTone}`} role="status">
            {statusTone === 'ok' && <Check size={13} />}
            {status}
          </span>
        )}
      </div>

      <div className="editor-fm">
        <details open={!!frontmatter}>
          <summary>Frontmatter（YAML，如 title / description / tags）</summary>
          <textarea
            rows={3}
            value={frontmatter}
            onChange={(e) => setFrontmatter(e.target.value)}
            placeholder={'title: 文档标题\ndescription: 简短描述\ntags: [指南]'}
          />
        </details>
      </div>

      <div className="editor-main">
        {mode === 'source' ? (
          <>
            {showEditorPane && (
              <div
                className="editor-pane"
                onDrop={(e) => {
                  if (e.dataTransfer?.files?.length) {
                    e.preventDefault()
                    uploadFiles(e.dataTransfer.files)
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
              >
                <CodeMirror
                  value={body}
                  onChange={setBody}
                  extensions={[markdown()]}
                  onCreateEditor={(view) => {
                    viewRef.current = view
                  }}
                  onPaste={(e) => {
                    if (e.clipboardData?.files?.length) {
                      e.preventDefault()
                      uploadFiles(e.clipboardData.files)
                    }
                  }}
                  height="100%"
                  style={{ height: '100%' }}
                />
              </div>
            )}
            {showPreviewPane && (
              <div className="editor-pane preview" onClick={onPreviewClick}>
                <div ref={previewRef} className="md-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            )}
          </>
      ) : (
          <div className="editor-pane">
            <Wysiwyg
              initialValue={body}
              docDir={docDir}
              onChange={setBody}
              onNotify={(m, t) => {
                setStatus(m)
                setStatusTone(t ?? 'info')
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
