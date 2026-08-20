'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import {
  ArrowLeft,
  Check,
  Code2,
  Columns2,
  Eye,
  FileText,
  ImageDown,
  PenLine,
  Save,
  Sigma,
  Sparkles,
  SquareChartGantt,
  X,
} from 'lucide-react'
import { joinFrontmatter, splitFrontmatter } from '@/lib/markdown/frontmatter'
import { copyText } from '@/lib/clipboard'
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

/* CodeMirror 扩展模块级共享（不可变描述符，可安全复用）：
 * @uiw/react-codemirror 在 extensions/onUpdate 引用变化时会对编辑器做全量
 * StateEffect.reconfigure，重建所有 StateField——搜索面板、撤销历史一并重置。
 * 之前每次渲染都新建数组，回车跳到匹配项 → 选区变化 → setSelPos → 重渲染 →
 * 搜索面板被销毁，表现为「回车后搜索栏消失」。 */
const CM_EXTENSIONS = [markdown({ base: markdownLanguage, codeLanguages: languages }), EditorView.lineWrapping]

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
  const [localizing, setLocalizing] = useState(false)
  // 外链图片转存改写内容后自增，强制 Wysiwyg 重挂载以显示新内容（Crepe 仅挂载时读 initialValue）
  const [gen, setGen] = useState(0)

  // ------- AI 辅助（选区文字变换） -------
  interface AssistState {
    action: string
    label: string
    from: number
    to: number
    running: boolean
    result: string
    error: string
  }
  interface SelPos {
    from: number
    to: number
    text: string
    x: number
    y: number
  }
  const [aiOn, setAiOn] = useState(false)
  const [selPos, setSelPos] = useState<SelPos | null>(null)
  const [assist, setAssist] = useState<AssistState | null>(null)
  const assistAbort = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/chat/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAiOn(Boolean(d?.enabled)))
      .catch(() => {})
  }, [])

  /** CodeMirror 选区跟踪：非空选区时给浮动工具条定位。
   *  useCallback 稳定引用：见 CM_EXTENSIONS 注释（引用变化会触发全量重配置） */
  const onEditorUpdate = useCallback((vu: ViewUpdate) => {
    const s = vu.state.selection.main
    if (s.empty || mode !== 'source') {
      setSelPos(null)
      return
    }
    const text = vu.state.sliceDoc(s.from, s.to)
    if (!text.trim()) {
      setSelPos(null)
      return
    }
    const coords = vu.view.coordsAtPos(s.to)
    if (!coords) {
      setSelPos(null)
      return
    }
    const x = Math.min(Math.max(8, coords.left - 60), window.innerWidth - 380)
    setSelPos({ from: s.from, to: s.to, text, x, y: coords.bottom + 6 })
  }, [mode])

  const ASSIST_BTNS = [
    ['polish', '润色'],
    ['continue', '续写'],
    ['translate', '翻译'],
    ['title', '起标题'],
    ['summary', '总结'],
  ] as const

  async function runAssist(action: (typeof ASSIST_BTNS)[number][0], label: string) {
    if (!selPos || assist?.running) return
    const { from, to, text } = selPos
    assistAbort.current = new AbortController()
    const st: AssistState = { action, label, from, to, running: true, result: '', error: '' }
    setAssist(st)
    setSelPos(null)
    try {
      const res = await fetch('/api/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, text }),
        signal: assistAbort.current.signal,
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
          if (ev.type === 'delta') {
            setAssist((a) => (a ? { ...a, result: a.result + (ev.newBlock && a.result ? '\n\n' : '') + ev.text } : a))
          } else if (ev.type === 'error') {
            throw new Error(ev.error)
          }
        }
      }
      setAssist((a) => (a ? { ...a, running: false } : a))
    } catch (err) {
      setAssist((a) =>
        a ? { ...a, running: false, error: err instanceof Error ? err.message : '生成失败' } : a,
      )
    }
  }

  function applyAssist(mode_: 'replace' | 'insert') {
    const view = viewRef.current
    if (!view || !assist?.result.trim()) return
    if (mode_ === 'replace') {
      view.dispatch({ changes: { from: assist.from, to: assist.to, insert: assist.result.trim() } })
    } else {
      view.dispatch({ changes: { from: assist.to, insert: '\n\n' + assist.result.trim() } })
    }
    view.focus()
    setAssist(null)
  }

  function closeAssist() {
    assistAbort.current?.abort()
    setAssist(null)
  }

  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'ok' | 'err' | 'info'>('info')
  const [commitMsg, setCommitMsg] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)
  const previewPaneRef = useRef<HTMLDivElement>(null)
  const editorPaneRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // @uiw/react-codemirror 要等容器 ref 落地后的第二轮 effect 才创建 EditorView，
  // 用 state 感知创建时机（ref 变化不触发渲染，同步滚动 effect 依赖它重跑）
  const [cmInstance, setCmInstance] = useState<EditorView | null>(null)

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

  // ------- 草稿自动保存（localStorage） -------
  // 防止浏览器崩溃/误关丢失未保存内容：dirty 期间防抖写入，保存成功自动清除。
  // 再次打开同一文档时发现草稿则提示恢复/丢弃；草稿恢复后保存仍走乐观锁，
  // 文档在草稿期间被他人改过会正常收到 409 冲突提示。
  interface Draft {
    body: string
    fm: string
    savedAt: string
  }
  const draftKey = `gitmd:draft:${path}`
  const [draft, setDraft] = useState<Draft | null>(null)

  // 挂载时探测既有草稿；与服务器内容一致的草稿是保存成功的残留，直接清掉
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return
      const d = JSON.parse(raw) as Draft
      if (typeof d.body === 'string' && (d.body !== initialBody || d.fm !== initialFrontmatter)) {
        setDraft(d)
      } else {
        localStorage.removeItem(draftKey)
      }
    } catch {
      // localStorage 不可用（隐私模式等）时静默跳过草稿功能
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // dirty 期间防抖写入；变干净（保存成功/放弃修改）时清除
  useEffect(() => {
    if (!dirty) {
      try {
        localStorage.removeItem(draftKey)
      } catch {}
      return
    }
    const timer = setTimeout(() => {
      try {
        const d: Draft = { body, fm: frontmatter, savedAt: new Date().toISOString() }
        localStorage.setItem(draftKey, JSON.stringify(d))
      } catch {}
    }, 800)
    return () => clearTimeout(timer)
  }, [body, frontmatter, dirty, draftKey])

  function restoreDraft() {
    if (!draft) return
    setBody(draft.body)
    setFrontmatter(draft.fm)
    setGen((g) => g + 1) // Wysiwyg 仅挂载时读 initialValue，重挂载以显示草稿内容
    setDraft(null)
    setStatus('已恢复草稿（尚未保存，保存后才会提交到仓库）')
    setStatusTone('info')
  }

  function discardDraft() {
    try {
      localStorage.removeItem(draftKey)
    } catch {}
    setDraft(null)
  }

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

  // ------- 分屏同步滚动 -------
  // 预览 HTML 的块元素带 data-source-start/end（rehypeSourcePos），与 CodeMirror
  // 文档偏移是同一坐标系 → 双向块级对齐，相邻锚点间按比例内插。
  // 程序化滚动会回触发 scroll 事件，用时间戳 guard 忽略另一侧 150ms 内的事件防止乒乓。
  useEffect(() => {
    if (mode !== 'source' || view !== 'split') return
    const cm = editorPaneRef.current?.querySelector<HTMLElement>('.cm-scroller')
    const pane = previewPaneRef.current
    const bodyEl = previewRef.current
    if (!cm || !pane || !bodyEl || !viewRef.current) return

    const TOP = 12 // 对齐视口顶部时的留白
    const guard = { cm: 0, pane: 0 }

    function syncPreviewToSource() {
      const cmView = viewRef.current
      if (!cmView || !cm || !pane || !bodyEl) return
      const offset = cmView.lineBlockAtHeight(cm.scrollTop + TOP).from
      const els = Array.from(bodyEl.querySelectorAll<HTMLElement>('[data-source-start]'))
      if (!els.length) return
      // 二分：文档序中最后一个 start <= offset 的锚点（start 单调递增）
      let lo = 0
      let hi = els.length - 1
      let idx = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (Number(els[mid].dataset.sourceStart) <= offset) {
          idx = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      const el = els[idx]
      const start = Number(el.dataset.sourceStart)
      const end = Number(el.dataset.sourceEnd ?? start)
      const paneRect = pane.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const elTop = elRect.top - paneRect.top + pane.scrollTop
      let target = elTop
      if (end > start && elRect.height > 0) {
        // 锚点自身跨度的内插：高块（代码块/表格）内部也能按行对齐，且覆盖最后一个锚点
        const f = Math.min(1, Math.max(0, (offset - start) / (end - start)))
        target = elTop + f * elRect.height
      } else {
        const next = els[idx + 1]
        if (next) {
          const nextStart = Number(next.dataset.sourceStart)
          if (nextStart > start) {
            const nextTop = next.getBoundingClientRect().top - paneRect.top + pane.scrollTop
            const f = Math.min(1, Math.max(0, (offset - start) / (nextStart - start)))
            target = elTop + f * (nextTop - elTop)
          }
        }
      }
      guard.pane = performance.now() + 150
      pane.scrollTop = target - TOP
    }

    function syncSourceToPreview() {
      const cmView = viewRef.current
      if (!cmView || !cm || !pane || !bodyEl) return
      const paneRect = pane.getBoundingClientRect()
      const targetY = paneRect.top + TOP
      // 只取 .md-body 的直接子块：垂直方向单调不重叠（margin 折叠也不重叠），
      // 可二分；块无锚点时（如 figure.code-block）取内部第一个锚点的源码区间
      const blocks: { start: number; end: number; el: Element }[] = []
      for (const child of Array.from(bodyEl.children)) {
        const host =
          (child as HTMLElement).dataset?.sourceStart != null
            ? (child as HTMLElement)
            : child.querySelector<HTMLElement>('[data-source-start]')
        if (!host) continue
        blocks.push({
          start: Number(host.dataset.sourceStart),
          end: Number(host.dataset.sourceEnd ?? host.dataset.sourceStart),
          el: child,
        })
      }
      if (!blocks.length) return
      // 第一个 bottom 越过视口顶的块 = 视口顶所在（或下方最近）的块；
      // 落在块间 margin 空隙也没关系——不再依赖 elementFromPoint 命中
      let lo = 0
      let hi = blocks.length - 1
      let idx = blocks.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (blocks[mid].el.getBoundingClientRect().bottom > targetY) {
          idx = mid
          hi = mid - 1
        } else {
          lo = mid + 1
        }
      }
      const blk = blocks[idx]
      const rect = blk.el.getBoundingClientRect()
      // 块被视口顶遮住的比例（视口顶在块上方空隙时为 0）→ 源码偏移内插
      const f =
        rect.height > 0 && rect.top <= targetY
          ? Math.min(1, Math.max(0, (targetY - rect.top) / rect.height))
          : 0
      const offset = Math.round(blk.start + f * Math.max(0, blk.end - blk.start))
      const block = cmView.lineBlockAt(Math.min(Math.max(0, offset), cmView.state.doc.length))
      guard.cm = performance.now() + 150
      cm.scrollTop = Math.max(0, block.top - TOP)
    }

    let raf = 0
    const onCmScroll = () => {
      if (performance.now() < guard.cm) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(syncPreviewToSource)
    }
    const onPaneScroll = () => {
      if (performance.now() < guard.pane) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(syncSourceToPreview)
    }
    cm.addEventListener('scroll', onCmScroll, { passive: true })
    pane.addEventListener('scroll', onPaneScroll, { passive: true })
    // 切到分屏时立即对齐一次（两侧内容高度可能差很多）
    raf = requestAnimationFrame(syncPreviewToSource)
    return () => {
      cm.removeEventListener('scroll', onCmScroll)
      pane.removeEventListener('scroll', onPaneScroll)
      cancelAnimationFrame(raf)
    }
  }, [mode, view, cmInstance])

  // ------- 保存（NDJSON 流式：committed/pushed 分阶段提示） -------
  interface SaveEvent {
    stage?: 'committed' | 'pushed' | 'done' | 'error'
    ok?: boolean
    head?: string
    hash?: string
    content?: string
    images?: { localized: number; failed: number }
    error?: string
    conflict?: boolean
    currentContent?: string
    currentHash?: string
  }

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

    /** 逐行消费 NDJSON 事件流；阶段事件更新状态栏，返回最终结果；错误事件抛出 */
    const consume = async (res: Response): Promise<SaveEvent> => {
      if (!res.body) return (await res.json()) as SaveEvent
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let final: SaveEvent | null = null
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const ev = JSON.parse(line) as SaveEvent
          if (ev.stage === 'committed') {
            setStatus('已提交到本地仓库，推送中…')
          } else if (ev.stage === 'pushed') {
            setStatus('已推送到远端仓库 ✓')
          } else if (ev.stage === 'done') {
            final = ev
          } else if (ev.stage === 'error') {
            throw Object.assign(new Error(ev.error ?? '保存失败'), ev)
          }
        }
      }
      return final ?? {}
    }

    const conflictDialog = () =>
      dialog.confirm({
        title: '保存冲突',
        message:
          '该文档在你编辑期间已被他人修改。\n\n「覆盖远端」将以你的内容为准；「取消」保留编辑器内容，你可以先复制保存再手动合并。',
        confirmText: '覆盖远端',
        danger: true,
      })

    try {
      let res = await attempt(hash)
      if (res.status === 409) {
        const data = await res.json()
        if (!(await conflictDialog())) {
          setStatus('已取消保存')
          setStatusTone('info')
          setSaving(false)
          return
        }
        res = await attempt(data.currentHash ?? '')
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? '保存失败')
      }
      let data: SaveEvent
      try {
        data = await consume(res)
      } catch (err) {
        // 入队后的二次校验冲突（罕见）：走同一覆盖确认流程
        if (err instanceof Error && (err as SaveEvent).conflict) {
          if (!(await conflictDialog())) {
            setStatus('已取消保存')
            setStatusTone('info')
            return
          }
          data = await consume(await attempt((err as SaveEvent).currentHash ?? ''))
        } else {
          throw err
        }
      }
      setHash(data.hash ?? hash)
      if (typeof data.content === 'string' && data.content !== content) {
        // 服务端转存外链图片改写了内容：同步编辑器与未保存基线
        const split = splitFrontmatter(data.content)
        setFrontmatter(split.frontmatter)
        setBody(split.body)
        setSaved({ body: split.body, fm: split.frontmatter })
        setGen((g) => g + 1)
      } else {
        setSaved({ body: bodyRef.current, fm: fmRef.current })
      }
      setCommitMsg('')
      const imgs = data.images
      setStatus(
        '已提交并推送 ✓' +
          (imgs?.localized ? `（转存 ${imgs.localized} 张外链图片）` : '') +
          (imgs?.failed ? `（${imgs.failed} 张外链图下载失败，已保留原链接）` : ''),
      )
      setStatusTone(imgs?.failed ? 'err' : 'ok')
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
  async function uploadFiles(files: FileList | File[]) {    for (const file of Array.from(files)) {
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

  // ------- 外链图片转存（图片立即提交，文档内容替换编辑器缓冲后由用户保存） -------
  async function localizeImages() {
    if (saving || localizing) return
    setLocalizing(true)
    setStatus('正在转存外链图片…')
    setStatusTone('info')
    const content = joinFrontmatter(fmRef.current, bodyRef.current)
    try {
      const res = await fetch('/api/assets/localize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? '转存失败')
      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0
      if (!data.localized && !failedCount) {
        setStatus('没有需要转存的外链图片')
        setStatusTone('ok')
        return
      }
      if (typeof data.content === 'string' && data.content !== content) {
        const split = splitFrontmatter(data.content)
        setFrontmatter(split.frontmatter)
        setBody(split.body)
        setGen((g) => g + 1)
      }
      setStatus(
        `已转存 ${data.localized} 张外链图片，请保存文档` +
          (failedCount ? `（${failedCount} 张失败：${data.failed.map((f: { url: string }) => f.url).join('、')}）` : ''),
      )
      setStatusTone(failedCount ? 'err' : 'ok')
    } catch (err) {
      setStatus('转存失败：' + (err instanceof Error ? err.message : String(err)))
      setStatusTone('err')
    } finally {
      setLocalizing(false)
    }
  }

  // 预览面板里代码块复制/折叠按钮（HTML 预览模式下的事件委托）
  function onPreviewClick(e: React.MouseEvent) {
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
    const btn = target.closest('.copy-btn')
    if (!btn) return
    const text = btn.closest('figure.code-block')?.querySelector('pre')?.textContent ?? ''
    copyText(text).then((ok) => {
      if (!ok) return
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

        <button
          className="btn btn-ghost btn-sm"
          onClick={localizeImages}
          disabled={localizing || saving}
          title="把文档中的外链图片下载到仓库 assets/ 并替换为本地路径（图片立即提交，文档需保存）"
        >
          {localizing ? <span className="spinner" /> : <ImageDown size={13} />}
          {localizing ? '转存中' : '转存外链图'}
        </button>

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

      {draft && (
        <div className="draft-banner" role="alert">
          <span className="draft-banner-text">
            发现 {new Date(draft.savedAt).toLocaleString('zh-CN')} 的未保存草稿
          </span>
          <button className="btn btn-sm btn-primary" onClick={restoreDraft}>
            恢复草稿
          </button>
          <button className="btn btn-sm btn-ghost" onClick={discardDraft}>
            丢弃
          </button>
        </div>
      )}

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
                ref={editorPaneRef}
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
                  onUpdate={onEditorUpdate}
                  extensions={CM_EXTENSIONS}
                  onCreateEditor={(view) => {
                    viewRef.current = view
                    setCmInstance(view)
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
              <div ref={previewPaneRef} className="editor-pane preview" onClick={onPreviewClick}>
                <div ref={previewRef} className="md-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              </div>
            )}
          </>
      ) : (
          <div className="editor-pane">
            <Wysiwyg
              key={gen}
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

      {/* AI 辅助：选区浮动工具条 */}
      {aiOn && selPos && !assist && (
        <div className="assist-toolbar" style={{ left: selPos.x, top: selPos.y }}>
          <span className="assist-toolbar-label">
            <Sparkles size={12} />
            AI
          </span>
          {ASSIST_BTNS.map(([key, label]) => (
            <button key={key} className="assist-toolbar-btn" onClick={() => runAssist(key, label)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* AI 辅助：结果面板 */}
      {assist && (
        <div className="assist-panel">
          <div className="assist-panel-head">
            <span>
              <Sparkles size={13} />
              {assist.label}
              {assist.running && '（生成中…）'}
            </span>
            <button className="btn btn-icon" style={{ width: 22, height: 22 }} aria-label="关闭" onClick={closeAssist}>
              <X size={13} />
            </button>
          </div>
          <div className="assist-panel-body">
            {assist.result ? assist.result : <span className="muted">正在生成…</span>}
            {assist.error && <div className="chat-error">{assist.error}</div>}
          </div>
          <div className="assist-panel-actions">
            <button className="btn btn-sm btn-primary" onClick={() => applyAssist('replace')} disabled={assist.running || !assist.result.trim()}>
              替换选中
            </button>
            <button className="btn btn-sm" onClick={() => applyAssist('insert')} disabled={assist.running || !assist.result.trim()}>
              插入其后
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                copyText(assist.result)
              }}
              disabled={!assist.result.trim()}
            >
              复制
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
