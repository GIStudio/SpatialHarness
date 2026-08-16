/**
 * 浏览器 Worker 的 Node 全局垫片（须在 worker 入口最先导入，早于任何库代码执行）。
 * GeoPackage 栈（@ngageoint/geopackage 及其依赖 wkx / file-type 等）在运行时
 * 引用全局 `Buffer` 与 `process`；Vite 把 Node 内置模块 externalize 为空 stub，
 * 且不提供这些全局变量，故在此显式挂载最小可用实现。
 * - Buffer：来自项目已有的 buffer polyfill（`buffer` 已别名）。
 * - process：最小桩，`version` 置空使库的 isNode 检测判为浏览器，避免走 fs 分支。
 */
import { Buffer } from 'buffer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any

if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer
}

if (typeof g.process === 'undefined') {
  g.process = { env: {}, version: '', browser: true }
}

export {}
