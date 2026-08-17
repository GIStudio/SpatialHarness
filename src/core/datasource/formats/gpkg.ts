/**
 * GeoPackage 桥接：基于 @ngageoint/geopackage + rtree-sql.js（SQLite WASM）。
 * Web Worker / Node（vitest / MCP）统一走纯 WASM 路径，无原生依赖：
 * - 显式注册 SqljsAdapter，绕开 better-sqlite3 与库内环境检测盲区（ESM 模块工人）
 * - Node：wasmBinary 直注（老版 emscripten 的 file:// 与 fetch 分支在 Node 25 均不可靠）
 * - 浏览器：locateFile 指向打包资源 URL，走 fetch
 *
 * 约定：写入统一 EPSG:4326（与本工作台内部一致）；读取不做坐标转换，
 * 非 4326 的 SRS 仅记录 warning。
 */
import type { Feature } from 'geojson'
import type { ParseResult } from '../types'
import { inferLayerMeta } from '@/core/layers/model'
import { readTileTable, writeGpkgTiles, type GeoPackageTilesLike } from './gpkgTiles'

export interface GpkgWasmConfig {
  /** 浏览器：sql-wasm.wasm 资源 URL（交给 locateFile，fetch 加载） */
  wasmUrl?: string
  /** Node：sql-wasm.wasm 字节（wasmBinary 直注） */
  wasmBytes?: Uint8Array
}

let wasmConfig: GpkgWasmConfig | null = null

/** 配置 WASM 来源（Web 侧在 worker 入口调用；Node 侧在进程入口调用） */
export function configureGpkg(cfg: GpkgWasmConfig): void {
  wasmConfig = cfg
}

/** 无渲染需求的空 Canvas 适配器（库的 open/create 会初始化 canvas，要素读写用不到） */
class NoopCanvasAdapter {
  isInitialized(): boolean {
    return true
  }
  initialize(): Promise<void> {
    return Promise.resolve()
  }
}

let readyPromise: Promise<void> | null = null

// 库 API 的最小类型面（深路径模块无 d.ts 的部分用 unknown 承接）
interface GeoPackageLike {
  createFeatureTable(name: string, geometryColumns: unknown, columns: { name: string; dataType: string }[]): boolean
  addGeoJSONFeaturesToGeoPackage(features: Feature[], table: string, index: boolean): Promise<number>
  export(): Promise<Uint8Array>
  getFeatureTables(): string[]
  getTileTables(): string[]
  getTileDao(table: string): unknown
  queryForGeoJSONFeaturesInTable(table: string): Feature[]
  close(): void
}

interface GpkgRuntime {
  GeoPackageAPI: { create(path?: string): Promise<GeoPackageLike>; open(bytes: Uint8Array): Promise<GeoPackageLike> }
  BoundingBox: new (minLongitude: number, maxLongitude: number, minLatitude: number, maxLatitude: number) => unknown
}

async function ensureReady(): Promise<GpkgRuntime> {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (!wasmConfig || (!wasmConfig.wasmUrl && !wasmConfig.wasmBytes)) {
        throw new Error('GeoPackage 未配置 WASM 来源：请先调用 configureGpkg({ wasmUrl } 或 { wasmBytes })')
      }
      // 静默库在 Node 下 better-sqlite3 缺失的降级日志（我们显式走 sql.js）
      const origError = console.error
      console.error = (...args: unknown[]) => {
        if (typeof args[0] === 'string' && args[0].includes('SqliteAdapter')) return
        origError(...args)
      }
      try {
        const [gpkg, initSqlJsModule, dbModule] = await Promise.all([
          import('@ngageoint/geopackage'),
          import('rtree-sql.js'),
          import('@ngageoint/geopackage/dist/lib/db/db'),
        ])
        const initSqlJs = (initSqlJsModule as { default: (cfg: Record<string, unknown>) => Promise<unknown> }).default
        const SQL = wasmConfig.wasmBytes
          ? await initSqlJs({ wasmBinary: wasmConfig.wasmBytes })
          : await initSqlJs({ locateFile: () => wasmConfig!.wasmUrl })
        // 显式装配：sql.js 适配器 + 空 canvas（覆盖库内环境检测，兼容 ESM 模块工人）
        ;(gpkg.SqljsAdapter as unknown as { SQL?: unknown }).SQL = SQL
        dbModule.Db.registerDbAdapter(gpkg.SqljsAdapter as never)
        // 兼容性补丁：SqljsAdapter.insert 缺少 bindAndInsert 里的 undefined→null 守卫，
        // sql.js 对未定义绑定值直接抛错（如 TileDao.create 未设置自增主键 id 时）
        const SqljsAdapterCtor = gpkg.SqljsAdapter as unknown as {
          prototype: { insert: (sql: string, params: Record<string, unknown>) => unknown }
        }
        const origInsert = SqljsAdapterCtor.prototype.insert
        SqljsAdapterCtor.prototype.insert = function (this: unknown, sql: string, params: Record<string, unknown>) {
          if (params && !Array.isArray(params)) {
            for (const key of Object.keys(params)) {
              if (params[key] === undefined) params[key] = null
            }
          }
          return origInsert.call(this, sql, params)
        }
        gpkg.Canvas.registerCanvasAdapter(NoopCanvasAdapter as never)
        return gpkg as unknown as GpkgRuntime
      } finally {
        console.error = origError
      }
    })().then((rt) => {
      runtime = rt
    })
  }
  await readyPromise
  return runtime!
}

let runtime: GpkgRuntime | null = null

/* ------------------------------ 写入 ------------------------------ */

type GpkgType = 'TEXT' | 'INTEGER' | 'REAL' | 'BOOLEAN'

function inferColumnType(values: unknown[]): GpkgType {
  const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (nonNull.length === 0) return 'TEXT'
  if (nonNull.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return nonNull.every((v) => Number.isInteger(v as number)) ? 'INTEGER' : 'REAL'
  }
  if (nonNull.every((v) => typeof v === 'boolean')) return 'BOOLEAN'
  return 'TEXT'
}

/** SQLite 表名清洗（保留中英文，去掉非法字符） */
export function sanitizeGpkgTableName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}_]/gu, '_').replace(/^_+|_+$/g, '')
  return cleaned.length > 0 ? cleaned : 'features'
}

function toDbValue(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0
  return v ?? null
}

/** 由要素集合生成 GeoPackage 字节（单要素表，EPSG:4326） */
export async function writeGpkg(features: Feature[], layerName: string): Promise<Uint8Array> {
  const { GeoPackageAPI } = await ensureReady()
  const tableName = sanitizeGpkgTableName(layerName)

  const keys: string[] = []
  for (const f of features) {
    for (const k of Object.keys(f.properties ?? {})) {
      if (!keys.includes(k)) keys.push(k)
    }
  }
  const columns = keys.map((k) => ({
    name: k,
    dataType: inferColumnType(features.map((f) => (f.properties ?? {})[k] ?? null)),
  }))

  const gp = await GeoPackageAPI.create()
  try {
    gp.createFeatureTable(tableName, null, columns)
    const rows = features.map((f) => ({
      ...f,
      properties: Object.fromEntries(Object.entries(f.properties ?? {}).map(([k, v]) => [k, toDbValue(v)])),
    })) as Feature[]
    await gp.addGeoJSONFeaturesToGeoPackage(rows, tableName, false)
    return await gp.export()
  } finally {
    gp.close()
  }
}

/** 将整图（PNG）+ 4326 bbox 写入 GeoPackage 瓦片表（EPSG:3857 XYZ） */
export async function writeGpkgTilesFromImage(pngBytes: Uint8Array, bbox4326: [number, number, number, number], layerName: string): Promise<Uint8Array> {
  const { GeoPackageAPI, BoundingBox } = await ensureReady()
  const tableName = sanitizeGpkgTableName(layerName)
  return writeGpkgTiles(
    () => GeoPackageAPI.create() as unknown as Promise<GeoPackageTilesLike>,
    (minX, maxX, minY, maxY) => new BoundingBox(minX, maxX, minY, maxY),
    pngBytes,
    bbox4326,
    tableName,
  )
}

/* ------------------------------ 读取 ------------------------------ */

/**
 * 解析 GeoPackage：
 * - 每个要素表 → 一个矢量图层
 * - 每个瓦片表 → 读取并组装为整图栅格图层（kind='image'，PNG + 4326 bbox）
 */
export async function parseGpkg(buffer: ArrayBuffer, stem: string): Promise<ParseResult[]> {
  const { GeoPackageAPI } = await ensureReady()
  const gp = await GeoPackageAPI.open(new Uint8Array(buffer))
  try {
    const results: ParseResult[] = []
    const featureTables = gp.getFeatureTables()
    const multi = featureTables.length > 1
    for (const table of featureTables) {
      const features = gp.queryForGeoJSONFeaturesInTable(table).map((f, i) => {
        // 读回会带主键列 id（非用户属性），剥离；要素 id 保留行号
        const props = { ...(f.properties ?? {}) } as Record<string, unknown>
        delete props.id
        return { ...f, id: f.id ?? i, properties: props } as Feature
      })
      results.push({
        kind: 'vector',
        name: multi ? `${stem}.${table}` : stem,
        format: 'gpkg' as const,
        features,
        fields: inferLayerMeta(features).fields,
        warnings: [],
      })
    }

    // 瓦片表：组装为整图（最高可用层级），PNG + bbox
    const tileTables = gp.getTileTables()
    const tileMulti = tileTables.length > 1 || featureTables.length > 0
    for (const table of tileTables) {
      const assembled = readTileTable(gp as never, table)
      if (!assembled) continue
      const bytes = assembled.pngBytes.buffer.slice(assembled.pngBytes.byteOffset, assembled.pngBytes.byteOffset + assembled.pngBytes.byteLength)
      results.push({
        kind: 'raster',
        name: tileMulti ? `${stem}.${table}` : stem,
        format: 'gpkg-tiles' as const,
        data: bytes as ArrayBuffer,
        width: assembled.width,
        height: assembled.height,
        bands: 4,
        crs: 'EPSG:4326',
        bbox: assembled.bbox,
        warnings: assembled.warnings,
      })
    }

    if (results.length === 0) {
      results.push({
        kind: 'vector',
        name: stem,
        format: 'gpkg',
        features: [],
        fields: [],
        warnings: ['GeoPackage 中没有要素表/瓦片表（可能仅含属性表）'],
      })
    }
    return results
  } finally {
    gp.close()
  }
}
