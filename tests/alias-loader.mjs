import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SRC = path.resolve(process.cwd(), 'src')

/** 让 node --test（strip-types）能解析 tsconfig 的 "@/…" 路径别名 */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rel = specifier.slice(2)
    for (const candidate of [rel, rel + '.ts', rel + '.tsx', rel + '/index.ts']) {
      const abs = path.join(SRC, candidate)
      if (fs.existsSync(abs)) return { url: pathToFileURL(abs).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
