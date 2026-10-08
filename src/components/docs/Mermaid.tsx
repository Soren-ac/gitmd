'use client'

import { useEffect, useId, useRef, useState } from 'react'
import mermaid from 'mermaid'

// 必须在模块加载时（而非 useEffect）就禁用自动处理：
// 否则 mermaid 默认 startOnLoad 会在 hydration 期间改写 .mermaid 元素，导致 hydration mismatch
if (typeof window !== 'undefined') {
  mermaid.initialize({ startOnLoad: false, theme: 'base' })
}

function currentTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** 把设计令牌喂给 mermaid 的 base 主题。
 *  内置的 neutral/default/forest 主题把节点填充写死成灰/绿，落在暖白纸面上像色块；
 *  用 base + themeVariables 才能让它跟随我们自己的色板。 */
function themeVariables(theme: 'dark' | 'light') {
  const cs = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  const surface = v('--bg-content', theme === 'dark' ? '#15181c' : '#ffffff')
  const ink = v('--text', theme === 'dark' ? '#e6e4de' : '#23211d')
  const muted = v('--text-tertiary', theme === 'dark' ? '#8b929a' : '#6b6558')
  const accent = v('--accent', theme === 'dark' ? '#6fd3ae' : '#0f6b4f')
  const border = theme === 'dark' ? 'rgba(255,255,255,0.17)' : '#cfc9bb'
  return {
    background: surface,
    primaryColor: surface,
    primaryTextColor: ink,
    primaryBorderColor: border,
    secondaryColor: v('--accent-subtle', surface),
    secondaryTextColor: ink,
    secondaryBorderColor: border,
    tertiaryColor: surface,
    tertiaryTextColor: ink,
    tertiaryBorderColor: border,
    lineColor: muted,
    textColor: ink,
    mainBkg: surface,
    nodeBorder: border,
    nodeTextColor: ink,
    clusterBkg: surface,
    clusterBorder: border,
    titleColor: ink,
    edgeLabelBackground: surface,
    // 时序图 / 类图 / 状态图的分支着色
    actorBkg: surface,
    actorBorder: border,
    actorTextColor: ink,
    actorLineColor: muted,
    signalColor: ink,
    signalTextColor: ink,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: border,
    labelTextColor: ink,
    loopTextColor: ink,
    noteBkgColor: surface,
    noteBorderColor: border,
    noteTextColor: ink,
    altBackground: surface,
    classText: ink,
    fillType0: surface,
    fillType1: v('--accent-subtle', surface),
    fillType2: surface,
    fillType3: v('--accent-subtle', surface),
    // 甘特 / 饼图的强调色
    sectionBkgColor: surface,
    sectionBkgColor2: v('--accent-subtle', surface),
    taskBorderColor: border,
    taskTextColor: ink,
    taskTextOutsideColor: ink,
    gridColor: border,
    doneTaskBkgColor: v('--accent-subtle', surface),
    activeTaskBkgColor: accent,
    activeTaskBorderColor: accent,
    pie1: accent,
    pie2: v('--info', accent),
    pie3: muted,
    pie4: v('--warning', muted),
  }
}

function mermaidConfig(theme: 'dark' | 'light') {
  return {
    startOnLoad: false,
    theme: 'base' as const,
    themeVariables: themeVariables(theme),
    // SVG 内联样式里 var() 不一定能解析，写具体字体栈
    fontFamily:
      'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  }
}

/* 模块级 SVG 缓存：同一 (主题, 图表) 只渲染一次。
   主题来回切换时直接命中缓存，避免 N 张图同步重渲染卡死主线程。 */
const svgCache = new Map<string, string>()
const SVG_CACHE_MAX = 100

function svgCacheSet(key: string, svg: string) {
  if (svgCache.size >= SVG_CACHE_MAX) {
    const oldest = svgCache.keys().next().value
    if (oldest) svgCache.delete(oldest)
  }
  svgCache.set(key, svg)
}

/** 空闲时调度（避免切主题瞬间几十张图排队阻塞） */
function scheduleIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(cb)
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(cb, 0)
  return () => clearTimeout(id)
}

export default function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [error, setError] = useState('')
  const [themeTick, setThemeTick] = useState(0)

  // 主题切换时重渲染图表
  useEffect(() => {
    const onTheme = () => setThemeTick((t) => t + 1)
    window.addEventListener('gitmd-theme', onTheme)
    return () => window.removeEventListener('gitmd-theme', onTheme)
  }, [])

  useEffect(() => {
    const theme = currentTheme()
    const key = `${theme}:${chart}`
    const cached = svgCache.get(key)
    if (cached !== undefined) {
      if (ref.current) ref.current.innerHTML = cached
      return
    }
    let cancelled = false
    const cancelSchedule = scheduleIdle(() => {
      mermaid.initialize(mermaidConfig(theme))
      mermaid
        .render(`mmd${rawId}${themeTick}`, chart)
        .then(({ svg }) => {
          svgCacheSet(key, svg)
          if (!cancelled && ref.current) ref.current.innerHTML = svg
        })
        .catch((e) => {
          if (!cancelled) setError(String(e))
        })
    })
    return () => {
      cancelled = true
      cancelSchedule()
    }
  }, [chart, rawId, themeTick])

  if (error) {
    return (
      <pre className="mermaid-error">
        mermaid 渲染失败: {error}
        {'\n\n'}
        {chart}
      </pre>
    )
  }
  // innerHTML 由 mermaid 手动注入；类名避开 .mermaid 防止其自动处理选中
  return (
    <div className="mermaid-canvas">
      <div ref={ref} className="mermaid-diagram" suppressHydrationWarning />
    </div>
  )
}

/** 预览面板用：把 <pre data-mermaid> 就地渲染为 svg */
export async function hydrateMermaidBlocks(root: HTMLElement) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('pre[data-mermaid]'))
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i]
    const chart = el.textContent ?? ''
    const theme = currentTheme()
    const key = `${theme}:${chart}`
    try {
      let svg = svgCache.get(key)
      if (svg === undefined) {
        mermaid.initialize(mermaidConfig(theme))
        const result = await mermaid.render(`preview-mmd-${i}-${Date.now()}`, chart)
        svg = result.svg
        svgCacheSet(key, svg)
      }
      const canvas = document.createElement('div')
      canvas.className = 'mermaid-canvas'
      const inner = document.createElement('div')
      inner.className = 'mermaid-diagram'
      inner.innerHTML = svg
      canvas.appendChild(inner)
      el.replaceWith(canvas)
    } catch {
      // 语法错误时保留原文
    }
  }
}
