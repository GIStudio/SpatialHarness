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
import type { ParsedVectorData } from '../types'
import { inferLayerMeta } from '@/core/layers/model'

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
  queryForGeoJSONFeaturesInTable(table: string): Feature[]
  close(): void
}

interface GpkgRuntime {
  GeoPackageAPI: { create(path?: string): Promise<GeoPackageLike>; open(bytes: Uint8Array): Promise<GeoPackageLike> }
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

/* ------------------------------ 读取 ------------------------------ */

/** 解析 GeoPackage：每个要素表一个图层；无要素表时返回带 warning 的空结果 */
export async function parseGpkg(buffer: ArrayBuffer, stem: string): Promise<ParsedVectorData[]> {
  const { GeoPackageAPI } = await ensureReady()
  const gp = await GeoPackageAPI.open(new Uint8Array(buffer))
  try {
    const tables = gp.getFeatureTables()
    if (tables.length === 0) {
      return [
        {
          kind: 'vector',
          name: stem,
          format: 'gpkg',
          features: [],
          fields: [],
          warnings: ['GeoPackage 中没有要素表（可能仅含瓦片/属性表）'],
        },
      ]
    }
    const multi = tables.length > 1
    return tables.map((table) => {
      const features = gp.queryForGeoJSONFeaturesInTable(table).map((f, i) => {
        // 读回会带主键列 id（非用户属性），剥离；要素 id 保留行号
        const props = { ...(f.properties ?? {}) } as Record<string, unknown>
        delete props.id
        return { ...f, id: f.id ?? i, properties: props } as Feature
      })
      return {
        kind: 'vector',
        name: multi ? `${stem}.${table}` : stem,
        format: 'gpkg' as const,
        features,
        fields: inferLayerMeta(features).fields,
        warnings: [],
      }
    })
  } finally {
    gp.close()
  }
}
