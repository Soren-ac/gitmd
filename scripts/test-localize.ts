/* 冒烟测试：起本地 HTTP 服务器当"图床"，验证 localizeExternalImages 的收集/下载/重写逻辑
 * 运行：node --experimental-strip-types scripts/test-localize.ts
 * 注意：脚本内设 NO_PROXY=*，防止本机代理环境变量把 127.0.0.1 请求也送进代理 */
process.env.NO_PROXY = '*'
process.env.no_proxy = '*'

import { createServer } from 'node:http'
import { localizeExternalImages } from '../src/lib/content/images.ts'

// 1×1 PNG
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

const src = `---
title: 测试
---

# 标题

![截图](${B}/ok.png)

![带标题 *emphasis*](${B}/ok.png "图 1")

[![嵌套](${B}/ok.png)](https://link.example.com)

<img src="${B}/no-mime" alt="x"> 和 <img src='${B}/dead.png'>

![引用式][logo] 和 [链接引用][site]

[logo]: ${B}/ok.png "Logo"
[site]: https://site.example.com/page

![失败](${B}/dead.png)

![非图片](${B}/html)

![本地保留](/assets/keep.png) ![相对保留](./rel.png)

![](${B}/ok.png)
`

const r = await localizeExternalImages(src)
console.log('=== 重写后 ===')
console.log(r.content)
console.log('=== files ===', r.files.map((f) => `${f.rel} (${f.buf.length}B)`))
console.log('=== localized ===', r.localized)
console.log('=== failed ===', r.failed)

let failed = 0
const expect = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('FAIL: ' + msg)
    failed++
  } else {
    console.log('ok: ' + msg)
  }
}

expect(r.files.length === 2, '两个唯一内容文件（png 去重 + jpeg 嗅探）')
expect(r.files.some((f) => f.rel.endsWith('.png')) && r.files.some((f) => f.rel.endsWith('.jpg')), '扩展名正确')
expect(r.failed.length === 2, '404 与 text/html 进入失败列表')
expect((r.content.match(/\/assets\/ext-/g) ?? []).length === 6, '6 处成功重写（含 html/引用式/嵌套/空 alt）')
expect(r.content.includes('[带标题 *emphasis*](/assets/ext-'), 'alt 中的格式符号原样保留')
expect(r.content.includes('"图 1"'), '标题保留')
expect(r.content.includes('[logo]: /assets/ext-'), 'definition 重写')
expect(r.content.includes('[site]: https://site.example.com/page'), '链接引用 definition 不动')
expect(r.content.includes(`![失败](${B}/dead.png)`), '失败保留原链')
expect(r.content.includes('(/assets/keep.png)') && r.content.includes('(./rel.png)'), '本地路径不动')
expect(!r.content.includes('ok.png'), '原始外链全部清除')
expect(r.content.includes('https://link.example.com'), '普通链接不动')

server.close()
process.exitCode = failed ? 1 : 0
console.log(failed ? `\n${failed} 条断言失败` : '\n全部通过')
