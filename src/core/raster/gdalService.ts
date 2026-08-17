/**
 * GDAL 栅格处理服务：基于 gdal3.js（GDAL 3.8 WASM 移植，含 gdal_translate / gdalwarp / gdalinfo）。
 *
 * 环境适配（与 GeoPackage 的 sql.js 方案同一思路——一套核心代码跨 Web Worker / Node）：
 * - 浏览器 Worker：initGdalJs({ paths }) 指向 Vite 发射的 wasm/data/js 资产；
 *   输入经 File 对象交给库（经典 worker 走 WORKERFS，模块 worker 走 arrayBuffer→MEMFS）。
 * - Node（vitest / MCP）：gdal3.js/node 构建，输入写入临时目录以真实路径打开（NODEFS）。
 *   注意 macOS 的 /tmp 为符号链接，NODEFS 挂载需 realpath。
 *
 * GDAL 为 LGPL，wasm/data 资产约 20MB，全部按需加载（首次调用时才初始化）。
 */

export interface GdalAssetPaths {
  wasmUrl: string
  dataUrl: string
  jsUrl: string
}

export interface RasterInfo {
  type: string
  bandCount: number
  width: number
  height: number
  driverName?: string
  projectionWkt?: string
  /** 仿射变换 (originX, pixelWidth, 0, originY, 0, pixelHeight) */
  coordinateTransform?: Record<string, number>
  corners?: [number, number][]
}

export interface GdalRunResult {
  bytes: Uint8Array
  fileName: string
}

interface GdalFilePathLike {
  local?: string
  real?: string
}

interface GdalLike {
  open(files: unknown[], options?: string[]): Promise<{ datasets: unknown[]; errors?: unknown[] }>
  getInfo(ds: unknown): Promise<RasterInfo>
  gdal_translate(ds: unknown, options: string[]): Promise<GdalFilePathLike>
  gdalwarp(ds: unknown, options: string[]): Promise<GdalFilePathLike>
  getFileBytes(p: unknown): Promise<Uint8Array>
  close(ds: unknown): Promise<void>
}

/**
 * Vite dev 下动态 import('gdal3.js') 可能触发本模块重新求值（模块状态被重置），
 * 因此 paths 与单例缓存挂在 globalThis 上而非模块级变量。
 */
const PATHS_KEY = '__spatialharness_gdal_paths'
const PROMISE_KEY = '__spatialharness_gdal_promise'

/** 浏览器侧：配置 wasm/data/js 资产 URL（worker 入口调用） */
export function configureGdal(paths: GdalAssetPaths): void {
  ;(globalThis as Record<string, unknown>)[PATHS_KEY] = paths
}

function getAssetPaths(): GdalAssetPaths | null {
  return (globalThis as Record<string, unknown>)[PATHS_KEY] as GdalAssetPaths | null | undefined ?? null
}

function isNodeEnv(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node
}

async function getGdal(): Promise<GdalLike> {
  const globalCtx = globalThis as Record<string, unknown>
  const existing = globalCtx[PROMISE_KEY] as Promise<GdalLike> | undefined
  if (existing) return existing
  const promise = (async () => {
    if (isNodeEnv()) {
      const mod = await import('gdal3.js/node')
      const initGdalJs = (mod as { default?: (cfg?: unknown) => Promise<GdalLike> }).default ?? (mod as unknown as (cfg?: unknown) => Promise<GdalLike>)
      // 打包部署（MCP）时资产在 dist/ 而非 node_modules：configureGdal 提供了绝对路径。
      // 注意 node 分支的 locateFile 会把 `node_modules/gdal3.js/dist/package/` 前缀拼到
      // paths 值前面，因此用 config.path 指定资产所在目录（locateFile 拼的是文件名本身）
      const ap = getAssetPaths()
      if (ap && ap.wasmUrl) {
        const dir = ap.wasmUrl.replace(/[\\/][^\\/]*$/, '')
        return await initGdalJs({ path: dir })
      }
      return await initGdalJs()
    }
    const assetPaths = getAssetPaths()
    if (!assetPaths) throw new Error('GDAL 未配置资产路径：请先调用 configureGdal({ wasmUrl, dataUrl, jsUrl })')
    const mod = await import('gdal3.js')
    // gdal3.js 是 UMD：worker 的 ESM 环境无 module 全局时走 `globalThis.initGdalJs` 分支，
    // default 导出可能为 undefined，需回退到全局
    let initGdalJs = (mod as { default?: unknown }).default
    if (typeof initGdalJs !== 'function') {
      initGdalJs = (globalThis as Record<string, unknown>).initGdalJs as unknown
    }
    if (typeof initGdalJs !== 'function') throw new Error('无法加载 gdal3.js（initGdalJs 缺失）')
    // useWorker=false：gdal3.js 默认会再开内部 Worker（我们的栅格 worker 内不能再嵌套）；
    // 内联运行同样在本 worker 线程，不阻塞主线程
    // 注意 gdal3.js 期望 paths.wasm / paths.data / paths.js（不是 wasmUrl 等）
    const gdalPaths = { wasm: assetPaths.wasmUrl, data: assetPaths.dataUrl, js: assetPaths.jsUrl }
    return await (initGdalJs as (cfg?: unknown) => Promise<GdalLike>)({ paths: gdalPaths, useWorker: false })
  })()
  globalCtx[PROMISE_KEY] = promise
  return promise
}

/* ------------------------------ 输入输出适配 ------------------------------ */

let seq = 0

async function writeNodeInput(fileName: string, bytes: Uint8Array): Promise<string> {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  // macOS /tmp 为符号链接，NODEFS 挂载会失败 → realpath
  const base = fs.realpathSync(os.tmpdir())
  const dir = path.join(base, `spatialharness-gdal-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  const unique = `${seq++}_${fileName}`
  const full = path.join(dir, unique)
  fs.writeFileSync(full, bytes)
  return full
}

/** 打开输入数据集：Node 写临时文件走路径，浏览器用 File */
async function openInput(gdal: GdalLike, fileName: string, bytes: Uint8Array): Promise<unknown> {
  const input = isNodeEnv() ? await writeNodeInput(fileName, bytes) : new File([bytes], fileName)
  const result = await gdal.open([input])
  const ds = result.datasets?.[0]
  if (!ds) {
    const msg = Array.isArray(result.errors) && result.errors.length > 0 ? JSON.stringify(result.errors) : '无法识别的栅格文件'
    throw new Error(msg)
  }
  return ds
}

/** 读取产物字节（使用 gdal_translate/gdalwarp 返回的 FilePath） */
async function readOutput(gdal: GdalLike, outPath: GdalFilePathLike): Promise<GdalRunResult> {
  const bytes = await gdal.getFileBytes(outPath)
  const fullPath = outPath.real || outPath.local || ''
  const baseName = fullPath.split('/').pop() || 'output'
  return { bytes, fileName: baseName }
}

/* ------------------------------ 对外 API ------------------------------ */

/** gdalinfo：栅格元信息（尺寸/波段/驱动/坐标系/四角坐标） */
export async function gdalInfo(fileName: string, bytes: Uint8Array): Promise<RasterInfo> {
  const gdal = await getGdal()
  const ds = await openInput(gdal, fileName, bytes)
  try {
    return await gdal.getInfo(ds)
  } finally {
    await gdal.close(ds)
  }
}

/** gdal_translate：格式转换/裁剪/重采样等（options 为 gdal_translate 命令行参数） */
export async function gdalTranslate(fileName: string, bytes: Uint8Array, options: string[]): Promise<GdalRunResult> {
  const gdal = await getGdal()
  const ds = await openInput(gdal, fileName, bytes)
  try {
    const outPath = await gdal.gdal_translate(ds, options)
    return await readOutput(gdal, outPath)
  } finally {
    await gdal.close(ds)
  }
}

/** gdalwarp：重投影/配准（options 为 gdalwarp 命令行参数） */
export async function gdalWarp(fileName: string, bytes: Uint8Array, options: string[]): Promise<GdalRunResult> {
  const gdal = await getGdal()
  const ds = await openInput(gdal, fileName, bytes)
  try {
    const outPath = await gdal.gdalwarp(ds, options)
    return await readOutput(gdal, outPath)
  } finally {
    await gdal.close(ds)
  }
}
