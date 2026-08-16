/**
 * 数据源解析 Worker 入口：通过 Comlink 暴露 parseFiles / exportVector。
 * 注意：禁止默认导出（vite ?worker 需要显式命名导出之外仅 expose）。
 */
// 必须最先导入：GeoPackage 栈运行时需要全局 Buffer/process（早于任何库代码执行）
import './nodeShims'
import * as Comlink from 'comlink'
import type { DatasourceWorkerApi } from './types'
import { parseFiles } from './parse'
import { exportVector } from './exporters'
import { configureGpkg } from './formats/gpkg'
// GeoPackage 所需的 SQLite WASM：作为静态资源由 Vite 发射，worker 内 fetch 加载
import gpkgWasmUrl from '@ngageoint/geopackage/dist/sql-wasm.wasm?url'

configureGpkg({ wasmUrl: gpkgWasmUrl })

const api: DatasourceWorkerApi = {
  parseFiles,
  exportVector,
}

Comlink.expose(api)
