/**
 * 复制文本到剪贴板。Clipboard API 仅在安全上下文（https/localhost）可用，
 * http://IP 方式部署时自动降级为 execCommand('copy') 兜底。
 * 注意：降级路径要求由用户手势触发（点击等），调用方均满足。
 * 返回是否成功。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒等场景继续走降级
    }
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length) // iOS Safari
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
