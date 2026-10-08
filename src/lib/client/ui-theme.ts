'use client'

/**
 * UI 主题和颜色模式是两个维度：主题决定排版与空间语言，颜色模式只决定明暗色板。
 * 当前内置主题只有 editorial，保留这个边界让后续主题可以复用同一套组件逻辑。
 */
export const UI_THEMES = ['editorial', 'dashboard'] as const
export type UiTheme = (typeof UI_THEMES)[number]

export const DEFAULT_UI_THEME: UiTheme = 'editorial'

export function applyUiTheme(next: UiTheme) {
  const root = document.documentElement
  root.dataset.uiTheme = next
  try {
    localStorage.setItem('gitmd-ui-theme', next)
  } catch {
    // 隐私模式等场景下忽略持久化，当前页面仍然可以使用主题。
  }
  window.dispatchEvent(new Event('gitmd-ui-theme'))
}

export function currentUiTheme(): UiTheme {
  return document.documentElement.dataset.uiTheme === 'dashboard' ? 'dashboard' : DEFAULT_UI_THEME
}
