import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// 转存下载走代理感知调度器；测试全部打本地服务器，禁止代理干扰
process.env.NO_PROXY = '*'
process.env.no_proxy = '*'

const { localizeExternalImages } = await import('../src/lib/content/images.ts')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5])

const server = createServer((req, res) => {
  const url = req.url ?? ''
  if (url === '/ok.png') {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG)
  } else if (url === '/no-mime') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(JPEG)
  } else if (url === '/dead.png') {
    res.writeHead(404).end('nope')
  } else if (url === '/html') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>x</html>')
  } else {
    res.writeHead(404).end()
  }
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port
const B = `http://127.0.0.1:${port}`

test('行内图片转存并重写为内容哈希路径', async () => {
  const r = await localizeExternalImages(`![截图](${B}/ok.png)`)
  assert.equal(r.files.length, 1)
  assert.match(r.files[0].rel, /^assets\/ext-[0-9a-f]{16}\.png$/)
  assert.equal(r.content, `![截图](/${r.files[0].rel})`)
  assert.equal(r.failed.length, 0)
})

test('同一 URL 多处引用只下载一次', async () => {
  const r = await localizeExternalImages(`![a](${B}/ok.png)\n\n![b](${B}/ok.png)\n\n![](${B}/ok.png)`)
  assert.equal(r.files.length, 1)
  assert.equal((r.content.match(/\/assets\/ext-/g) ?? []).length, 3)
})

test('alt 中的格式符号与 title 原样保留', async () => {
  const r = await localizeExternalImages(`![带 *强调* 的 alt](${B}/ok.png "图 1")`)
  assert.match(r.content, /^!\[带 \*强调\* 的 alt\]\(\/assets\/ext-[0-9a-f]{16}\.png "图 1"\)$/)
})

test('HTML img 标签转存', async () => {
  const r = await localizeExternalImages(`<img src="${B}/ok.png" alt="x">`)
  assert.match(r.content, /^<img src="\/assets\/ext-/)
  assert.ok(r.content.includes('alt="x"'))
})

test('引用式图片转存 definition，链接引用不动', async () => {
  const src = `![引用式][logo] 和 [链接][site]\n\n[logo]: ${B}/ok.png "Logo"\n[site]: ${B}/ok.png`
  const r = await localizeExternalImages(src)
  assert.match(r.content, /\[logo\]: \/assets\/ext-[0-9a-f]{16}\.png "Logo"/)
  assert.ok(r.content.includes(`[site]: ${B}/ok.png`))
})

test('content-type 缺失时按魔数嗅探', async () => {
  const r = await localizeExternalImages(`![x](${B}/no-mime)`)
  assert.match(r.files[0].rel, /\.jpg$/)
})

test('失败保留原链并给出原因（404 / 非图片）', async () => {
  const r = await localizeExternalImages(`![a](${B}/dead.png)\n\n![b](${B}/html)`)
  assert.equal(r.files.length, 0)
  assert.ok(r.content.includes(`![a](${B}/dead.png)`))
  assert.equal(r.failed.length, 2)
  assert.equal(r.failed[0].reason, 'HTTP 404')
  assert.match(r.failed[1].reason, /非图片/)
})

test('本地路径与 data: URI 不受影响', async () => {
  const src = '![a](/assets/x.png) ![b](./rel.png) ![c](data:image/png;base64,AAAA)'
  const r = await localizeExternalImages(src)
  assert.equal(r.content, src)
  assert.equal(r.files.length, 0)
})

test.after(() => server.close())
