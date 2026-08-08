import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitFrontmatter, joinFrontmatter } from '../src/lib/markdown/frontmatter.ts'

test('splitFrontmatter：无 frontmatter 时原样返回', () => {
  const r = splitFrontmatter('# 标题\n正文')
  assert.equal(r.frontmatter, '')
  assert.equal(r.body, '# 标题\n正文')
})

test('splitFrontmatter：正确拆分 frontmatter 与正文', () => {
  const r = splitFrontmatter('---\ntitle: 测试\n---\n\n# 正文\n')
  assert.equal(r.frontmatter, 'title: 测试')
  assert.equal(r.body, '\n# 正文\n')
})

test('joinFrontmatter：空 frontmatter 返回正文', () => {
  assert.equal(joinFrontmatter('', '# 正文'), '# 正文')
  assert.equal(joinFrontmatter('  \n ', '# 正文'), '# 正文')
})

test('split/join 往返一致', () => {
  const original = '---\ntitle: 文档\ntags: [a]\n---\n\n正文内容\n'
  const { frontmatter, body } = splitFrontmatter(original)
  assert.equal(joinFrontmatter(frontmatter, body), original)
})
