/**
 * MCP 服务器构建：esbuild 把 mcp/src + 复用的 src/core 打成一个自包含文件。
 * 产物 dist/server.cjs 无外部运行时依赖（SDK / turf / shpjs 等全部内联），
 * 可直接 `node dist/server.cjs` 或 `npx @spatial-harness/mcp-server` 运行。
 * 使用 CJS 输出：shpjs 等 CJS 依赖含静态 require，ESM 打包会触发
 * "Dynamic require is not supported"。
 *
 * GeoPackage：SQLite 走 rtree-sql.js（WASM）。原生 better-sqlite3 替身为抛错
 * stub（库回退 sql.js）；sql-wasm.wasm 复制到 dist/ 供运行时按 __dirname 读取。
 */
import * as esbuild from 'esbuild'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const webSrc = path.resolve(root, '..', 'src')
const require = createRequire(import.meta.url)

const watch = process.argv.includes('--watch')

// 定位 rtree-sql.js 的 sql-wasm.wasm（从 Web 端 src 可解析到该包）
const wasmSrc = require.resolve('rtree-sql.js/dist/sql-wasm.wasm', { paths: [webSrc] })
const wasmDest = path.join(root, 'dist', 'sql-wasm.wasm')

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(root, 'dist/server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  // src/core 内部使用 `@/` 别名指向 Web 端 src 根；
  // better-sqlite3（原生）替身为抛错 stub，令 geopackage 回退 sql.js WASM
  alias: {
    '@': webSrc,
    'better-sqlite3': path.join(webSrc, 'core/datasource/formats/betterSqlite3Stub.ts'),
  },
  logLevel: 'info',
}

function copyWasm() {
  fs.mkdirSync(path.dirname(wasmDest), { recursive: true })
  fs.copyFileSync(wasmSrc, wasmDest)
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  copyWasm()
  console.log('[spatialharness-mcp] watching…')
} else {
  await esbuild.build(options)
  copyWasm()
  console.log('[spatialharness-mcp] built → dist/server.cjs (+ sql-wasm.wasm)')
}
