/**
 * load_dataset 实现：从本地文件路径或内联数据解析 GIS 文件，注册到 DatasetStore。
 * 复用 Web 端 src/core/datasource/parse.ts 的完整解析链路（GeoJSON / KML / GPX / CSV / Shapefile / GeoTIFF）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseFiles } from '@/core/datasource/parse'
import type { ImportFile, ParseResult } from '@/core/datasource/types'
import { DatasetStore, type StoredDataset } from './registry'
import { summarize, type DatasetSummary } from './summary'

export interface LoadedSummary {
  loaded: DatasetSummary[]
  raster: { name: string; width: number; height: number; bands: number; crs?: string }[]
  warnings: string[]
}

const SHAPE_EXTS = new Set(['shp', 'dbf', 'shx', 'prj'])

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function readShpGroup(absPath: string): Promise<ImportFile[]> {
  const dir = path.dirname(absPath)
  const stem = path.basename(absPath, '.shp')
  const entries = await fs.readdir(dir)
  const files: ImportFile[] = []
  for (const entry of entries) {
    const ext = path.extname(entry).slice(1).toLowerCase()
    if (!SHAPE_EXTS.has(ext)) continue
    if (path.basename(entry, path.extname(entry)) !== stem) continue
    const buf = await fs.readFile(path.join(dir, entry))
    files.push({ name: entry, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer })
  }
  if (!files.some((f) => f.name.toLowerCase().endsWith('.shp'))) {
    throw new Error(`路径不是有效的 Shapefile：缺少 ${stem}.shp`)
  }
  return files
}

/** 读取一个本地文件（.shp 时自动带上同主干名的 .dbf/.prj/.shx） */
async function readPath(absPath: string): Promise<ImportFile[]> {
  const stat = await fs.stat(absPath)
  if (stat.isDirectory()) {
    throw new Error(`路径是目录而非文件：${absPath}（当前仅支持单文件；目录批量导入请逐个文件调用 load_dataset）`)
  }
  const ext = path.extname(absPath).slice(1).toLowerCase()
  if (ext === 'shp') return readShpGroup(absPath)
  const buf = await fs.readFile(absPath)
  return [
    {
      name: path.basename(absPath),
      buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    },
  ]
}

export async function loadDataset(store: DatasetStore, args: { path?: string; name?: string; data?: string; encoding?: string }): Promise<LoadedSummary> {
  const encoding = args.encoding ?? 'utf8'
  const hasPath = typeof args.path === 'string' && args.path.length > 0
  const hasData = typeof args.data === 'string' && args.data.length > 0
  if (hasPath === hasData) {
    throw new Error('path 与 data 必须且只能提供一个：path=本地文件路径，或 data=文件内容（name 指定文件名）')
  }

  let files: ImportFile[]
  if (hasPath) {
    const abs = path.resolve(args.path!)
    try {
      files = await readPath(abs)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('路径是目录')) throw e
      throw new Error(`读取文件失败：${abs}（${errMsg(e)}）`)
    }
  } else {
    if (!args.name) throw new Error('使用 data 时必须提供 name（含扩展名，用于识别格式，如 data.geojson）')
    const raw = encoding === 'base64' ? Buffer.from(args.data!, 'base64') : Buffer.from(args.data!, 'utf8')
    const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
    files = [{ name: args.name, buffer }]
  }

  const results: ParseResult[] = await parseFiles(files)

  // parseFiles 对单个文件的失败只记 warning，且结果为空时 warning 无处挂载——
  // MCP 侧需要明确的错误，这里兜底：
  if (results.length === 0) {
    const exts = [...new Set(files.map((f) => f.name.split('.').pop()?.toLowerCase() ?? ''))].filter(Boolean)
    const supported = ['geojson', 'json', 'kml', 'gpx', 'csv', 'zip', 'shp', 'tif', 'tiff', 'gtiff']
    const unsupported = exts.filter((e) => !supported.includes(e))
    if (unsupported.length > 0) {
      throw new Error(`不支持的文件类型：${unsupported.join(', ')}（支持 GeoJSON/KML/GPX/CSV/Shapefile/GeoTIFF）`)
    }
    throw new Error('解析失败：文件内容无法识别或数据为空（请检查文件格式与编码）')
  }

  const loaded: StoredDataset[] = []
  const raster: LoadedSummary['raster'] = []
  const warnings: string[] = []
  for (const r of results) {
    warnings.push(...r.warnings)
    if (r.kind === 'vector') {
      const ds = store.add({
        name: r.name,
        format: r.format,
        features: r.features,
        fields: r.fields,
        geometryType: inferGeometryType(r.features),
        sourceCrs: r.sourceCrs,
        warnings: r.warnings,
      })
      loaded.push(ds)
    } else {
      raster.push({ name: r.name, width: r.width, height: r.height, bands: r.bands, crs: r.crs })
    }
  }

  return {
    loaded: loaded.map(summarize),
    raster,
    warnings: [...new Set(warnings)],
  }
}

function inferGeometryType(features: { geometry: unknown }[]): StoredDataset['geometryType'] {
  const types = new Set<string>()
  for (const f of features) {
    const g = f.geometry as { type?: string } | null
    if (!g?.type) continue
    if (g.type === 'MultiPoint') types.add('Point')
    else if (g.type === 'MultiLineString') types.add('LineString')
    else if (g.type === 'MultiPolygon' || g.type === 'Polygon') types.add('Polygon')
    else types.add(g.type)
  }
  if (types.size === 0) return 'None'
  if (types.size === 1) return [...types][0] as StoredDataset['geometryType']
  return 'Mixed'
}
