/**
 * 栅格处理主线程封装：通过 Comlink 调用 GDAL Worker。
 * Worker 与 GDAL JS 均为惰性加载（动态 import '?worker'）——
 * 未使用栅格处理时不产生任何下载/解析开销；wasm/data 资产更进一步
 * 推迟到首次 gdal 调用时才 fetch。
 */
import * as Comlink from 'comlink'
import type { RasterWorkerApi } from './types'
import type { RasterInfo, GdalRunResult } from './gdalService'

let proxyPromise: Promise<Comlink.Remote<RasterWorkerApi>> | null = null

function getProxy(): Promise<Comlink.Remote<RasterWorkerApi>> {
  if (!proxyPromise) {
    proxyPromise = import('./worker?worker').then((mod) => Comlink.wrap<RasterWorkerApi>(new mod.default()))
  }
  return proxyPromise
}

export const rasterInfo = async (fileName: string, bytes: Uint8Array): Promise<RasterInfo> =>
  (await getProxy()).gdalInfo(fileName, bytes)

export const rasterTranslate = async (fileName: string, bytes: Uint8Array, options: string[]): Promise<GdalRunResult> =>
  (await getProxy()).gdalTranslate(fileName, bytes, options)

export const rasterWarp = async (fileName: string, bytes: Uint8Array, options: string[]): Promise<GdalRunResult> =>
  (await getProxy()).gdalWarp(fileName, bytes, options)
