/* highlight.js 的 lib/languages/* 子路径没有独立类型声明，统一在此声明 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'
  const fn: LanguageFn
  export default fn
}
