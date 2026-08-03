const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** 拆分 frontmatter 与正文；无 frontmatter 时 frontmatter 为空串 */
export function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const m = content.match(FM_RE)
  if (!m) return { frontmatter: '', body: content }
  return { frontmatter: m[1], body: content.slice(m[0].length) }
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  const fm = frontmatter.trim()
  if (!fm) return body
  return `---\n${fm}\n---\n\n${body.replace(/^\s*\n/, '')}`
}
