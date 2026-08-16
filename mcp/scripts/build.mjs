/**
 * MCP 服务器构建：esbuild 把 mcp/src + 复用的 src/core 打成一个自包含文件。
 * 产物 dist/server.cjs 无外部运行时依赖（SDK / turf / shpjs 等全部内联），
 * 可直接 `node dist/server.cjs` 或 `npx @spatial-harness/mcp-server` 运行。
 * 使用 CJS 输出：shpjs 等 CJS 依赖含静态 require，ESM 打包会触发
 * "Dynamic require is not supported"。
 */
import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const webSrc = path.resolve(root, '..', 'src')

const watch = process.argv.includes('--watch')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(root, 'dist/server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  // src/core 内部使用 `@/` 别名指向 Web 端 src 根
  alias: { '@': webSrc },
  logLevel: 'info',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[spatialharness-mcp] watching…')
} else {
  await esbuild.build(options)
  console.log('[spatialharness-mcp] built → dist/server.cjs')
}
