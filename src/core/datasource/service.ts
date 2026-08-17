/**
 * 主线程封装：创建解析 Worker 并通过 Comlink 暴露类型化 API。
 * `?worker` 为 Vite 专用语法（tsconfig 已含 vite/client 类型）。
 */
import * as Comlink from 'comlink'
import type { DatasourceWorkerApi, ExportRequest, ExportResult, GpkgTilesRequest, ImportFile, ParseResult } from './types'
import Worker from './worker?worker'

const inst = new Worker()

export const datasource = Comlink.wrap<DatasourceWorkerApi>(inst)

/** 便捷调用：解析一组本地文件 */
export const parseFiles = (files: ImportFile[]): Promise<ParseResult[]> => datasource.parseFiles(files)

/** 便捷调用：导出矢量数据 */
export const exportVector = (req: ExportRequest): Promise<ExportResult> => datasource.exportVector(req)

/** 便捷调用：PNG 整图 → GeoPackage 瓦片表 */
export const exportGpkgTiles = (req: GpkgTilesRequest): Promise<Uint8Array> => datasource.exportGpkgTiles(req)
