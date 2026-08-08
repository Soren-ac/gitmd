import Link from 'next/link'
import { FileQuestion, GitBranch } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="notfound-wrap">
      <div className="notfound-card">
        <span className="logo-mark" style={{ width: 40, height: 40, borderRadius: 12 }}>
          <GitBranch size={18} />
        </span>
        <div className="notfound-code">404</div>
        <div className="empty-state" style={{ padding: '8px 0 0' }}>
          <FileQuestion size={26} />
          <div className="empty-title">页面不存在</div>
          <div className="empty-desc">你要找的文档或页面不存在，可能已被移动或删除。</div>
        </div>
        <Link href="/docs" className="btn btn-primary" style={{ marginTop: 20 }}>
          返回文档首页
        </Link>
      </div>
    </div>
  )
}
