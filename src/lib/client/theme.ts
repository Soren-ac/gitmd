'use client'

/** 切换主题：切换瞬间禁用全部 CSS transition，避免数百个元素同时做颜色动画造成卡顿 */
export function applyTheme(next: 'dark' | 'light') {
  const root = document.documentElement
  root.classList.add('theme-instant')
  root.dataset.theme = next
  try {
    localStorage.setItem('gitmd-theme', next)
  } catch {
    // 隐私模式等场景下忽略
  }
  window.dispatchEvent(new Event('gitmd-theme'))
  setTimeout(() => root.classList.remove('theme-instant'), 280)
}

export function currentAppTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}
