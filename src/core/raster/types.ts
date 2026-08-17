/**
 * 栅格处理 Worker API 契约（comlink）。
 * GDAL WASM 体积大（wasm+data 约 20MB），独立 worker 按需加载，
 * 不拖累解析 Worker 与主 bundle。
 */
import type { RasterInfo, GdalRunResult } from './gdalService'

export interface RasterWorkerApi {
  gdalInfo(fileName: string, bytes: Uint8Array): Promise<RasterInfo>
  gdalTranslate(fileName: string, bytes: Uint8Array, options: string[]): Promise<GdalRunResult>
  gdalWarp(fileName: string, bytes: Uint8Array, options: string[]): Promise<GdalRunResult>
}

export type { RasterInfo, GdalRunResult }
