/**
 * 栅格处理 Worker 入口：通过 Comlink 暴露 gdalInfo / gdalTranslate / gdalWarp。
 * GDAL WASM 与数据资产（约 20MB）由 Vite 发射为静态资源，首次调用时 fetch。
 */
// 必须最先导入：全局 Buffer/process 垫片（早于任何库代码执行）
import '../datasource/nodeShims'
import * as Comlink from 'comlink'
import type { RasterWorkerApi } from './types'
import { configureGdal, gdalInfo, gdalTranslate, gdalWarp } from './gdalService'
// gdal3.js 官方 Vite 集成方式：三个 ?url 资产
import gdalJsUrl from 'gdal3.js/dist/package/gdal3.js?url'
import gdalDataUrl from 'gdal3.js/dist/package/gdal3WebAssembly.data?url'
import gdalWasmUrl from 'gdal3.js/dist/package/gdal3WebAssembly.wasm?url'

configureGdal({ wasmUrl: gdalWasmUrl, dataUrl: gdalDataUrl, jsUrl: gdalJsUrl })
const api: RasterWorkerApi = {
  gdalInfo,
  gdalTranslate,
  gdalWarp,
}

Comlink.expose(api)
