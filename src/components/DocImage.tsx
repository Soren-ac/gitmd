'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

/** 文档图片：加载骨架 + 点击查看大图 */
export default function DocImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [zoomed, setZoomed] = useState(false)

  if (failed) {
    return (
      <span className="img-failed" role="img" aria-label={alt || '图片加载失败'}>
        图片加载失败：{alt || src}
      </span>
    )
  }

  return (
    <>
      <span className="doc-img-wrap">
        {!loaded && <span className="skeleton doc-img-skeleton" />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className={`doc-img ${loaded ? 'loaded' : ''}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          onClick={() => setZoomed(true)}
        />
        {alt && <span className="doc-img-caption">{alt}</span>}
      </span>
      {zoomed && (
        <div className="img-lightbox" onClick={() => setZoomed(false)} role="dialog" aria-label="查看大图">
          <button className="btn btn-icon lightbox-close" aria-label="关闭">
            <X size={18} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </>
  )
}
