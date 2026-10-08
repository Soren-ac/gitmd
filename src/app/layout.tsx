import type { Metadata } from 'next'
import { IBM_Plex_Mono, Literata, Newsreader } from 'next/font/google'
import 'katex/dist/katex.min.css'
import './globals.css'

/* 三款拉丁字体自托管；中文由 --font-cjk 系统栈兜底（Google Fonts 无中文字形，
   强行内嵌 Noto Sans SC 会带来数 MB 体积） */
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display',
})

const literata = Literata({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-serif',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-code',
})

export const metadata: Metadata = {
  title: 'GitMD 文档平台',
  description: 'Git 驱动的团队文档平台',
}

// 在首次绘制前确定主题与侧边栏状态（折叠/宽度），避免闪烁；无存储偏好时跟随系统主题
const themeInit = `(function(){try{
var t=localStorage.getItem('gitmd-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
document.documentElement.dataset.theme=t;
if(localStorage.getItem('gitmd-sidebar')==='collapsed')document.documentElement.dataset.sidebar='collapsed';
var w=parseInt(localStorage.getItem('gitmd-sidebar-w')||'',10);
if(w>=200&&w<=480)document.documentElement.style.setProperty('--sidebar-w',w+'px')
}catch(e){document.documentElement.dataset.theme='dark'}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${newsreader.variable} ${literata.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
