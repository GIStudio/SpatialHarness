/**
 * 数据源解析 Worker 入口：通过 Comlink 暴露 parseFiles / exportVector。
 * 注意：禁止默认导出（vite ?worker 需要显式命名导出之外仅 expose）。
 */
import * as Comlink from 'comlink'
import type { DatasourceWorkerApi } from './types'
import { parseFiles } from './parse'
import { exportVector } from './exporters'

const api: DatasourceWorkerApi = {
  parseFiles,
  // exporters.exportVector 为同步实现，Worker 协议要求 Promise
  exportVector: (req) => Promise.resolve(exportVector(req)),
}

Comlink.expose(api)
