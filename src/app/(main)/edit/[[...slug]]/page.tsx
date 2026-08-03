import path from 'node:path'
import { notFound, redirect } from 'next/navigation'
import { config } from '@/lib/config'
import { isRepoCloned } from '@/lib/git'
import { readDoc } from '@/lib/docs'
import { getSessionUser, gitIdentityOf } from '@/lib/auth'
import Editor from '@/components/Editor'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ slug?: string[] }>
  searchParams: Promise<{ new?: string }>
}

export default async function EditPage({ params, searchParams }: Props) {
  const { slug = [] } = await params
  const { new: isNew } = await searchParams
  if (slug.length === 0) notFound()

  // 未配置 git 身份 → 先去设置页（编辑需要以用户身份提交）
  const user = await getSessionUser()
  if (!user || !gitIdentityOf(user)) {
    const target = '/edit/' + slug.join('/') + (isNew ? '?new=1' : '')
    redirect('/settings?next=' + encodeURIComponent(target))
  }

  const rel = slug.map(decodeURIComponent).join('/')
  const relMd = /\.mdx?$/i.test(rel) ? rel : `${rel}.md`
  const abs = path.normalize(path.join(config.repoDir, relMd))
  if (abs !== config.repoDir && !abs.startsWith(config.repoDir + path.sep)) notFound()

  if (!isRepoCloned()) {
    return <div className="doc-container">仓库尚未就绪，请稍后再试。</div>
  }

  const doc = readDoc(abs)
  if (!doc.exists && isNew !== '1') notFound()

  const docDir = path.posix.dirname(relMd) === '.' ? '' : path.posix.dirname(relMd)

  return (
    <Editor
      path={relMd}
      docDir={docDir}
      initialFrontmatter={doc.frontmatter}
      initialBody={doc.body}
      initialHash={doc.exists ? doc.hash : ''}
      isNew={!doc.exists}
    />
  )
}
