/**
 * Shapefile 解析：.shp（必需）+ .dbf（可选）+ .prj（可选）按主干名合并。
 * 流程：shpjs 解出几何数组 → parseDbf 解出属性行 → combine 合并为 FeatureCollection；
 * .prj 决定坐标系（4326 直用；其他 code 或自定义 def 归一化到 4326）；
 * 无 .prj 时按带号坐标启发式推断 CGCS2000 投影，否则视为 4326。
 */
import shp from 'shpjs'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { ImportFile, ParsedVectorData } from '../types'
import { inferLayerMeta } from '@/core/layers/model'
import { inferCgcsZone, resolvePrj } from '@/core/crs/registry'
import { normalizeToWgs84 } from '@/core/crs/normalize'

const decodeText = (buffer: ArrayBuffer): string => new TextDecoder().decode(buffer)

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

function findFile(files: ImportFile[], ext: string): ImportFile | undefined {
  return files.find((f) => extOf(f.name) === ext)
}

function asArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v]
}

/** 取几何的第一个坐标对（用于无 .prj 时的带号推断） */
function firstCoord(geom: Geometry | null): Position | null {
  if (!geom) return null
  switch (geom.type) {
    case 'Point':
      return geom.coordinates
    case 'MultiPoint':
      return geom.coordinates[0] ?? null
    case 'LineString':
      return geom.coordinates[0] ?? null
    case 'MultiLineString':
      return geom.coordinates[0]?.[0] ?? null
    case 'Polygon':
      return geom.coordinates[0]?.[0] ?? null
    case 'MultiPolygon':
      return geom.coordinates[0]?.[0]?.[0] ?? null
    case 'GeometryCollection':
      for (const g of geom.geometries) {
        const c = firstCoord(g)
        if (c) return c
      }
      return null
    default:
      return null
  }
}

export async function parseShapefile(files: ImportFile[], stem: string): Promise<ParsedVectorData> {
  const shpFile = findFile(files, 'shp')
  if (!shpFile) throw new Error(`缺少 .shp 文件：${stem}`)

  // 1. 几何：parseShp 返回几何数组；单要素文件可能直接返回单个几何，统一规整为数组
  const geometries = asArray(shp.parseShp(shpFile.buffer) as Geometry | Geometry[])

  // 2. 属性：有 .dbf 则解析属性行，无则空对象
  const dbfFile = findFile(files, 'dbf')
  const rows: Record<string, unknown>[] | undefined = dbfFile
    ? (shp.parseDbf(dbfFile.buffer) as Record<string, unknown>[])
    : undefined

  // 3. 合并为 FeatureCollection
  const fc: FeatureCollection = rows
    ? (shp.combine([geometries, rows]) as FeatureCollection)
    : (shp.combine([geometries]) as FeatureCollection)

  // 4. 补要素 id
  const features: Feature[] = fc.features.map((f, i) => (f.id === undefined || f.id === null ? { ...f, id: `f_${i}` } : f))

  // 5. 坐标系处理
  const warnings: string[] = []
  let sourceCrs: string | undefined
  const prjFile = findFile(files, 'prj')
  if (prjFile) {
    const res = resolvePrj(decodeText(prjFile.buffer))
    if (res.code && res.code !== 'EPSG:4326') {
      // 已知 code（含自定义 '__custom__'）→ 归一化到 4326，记录原坐标系
      const norm = normalizeToWgs84(features, res.code)
      if (norm.converted) {
        return {
          kind: 'vector',
          name: stem,
          format: 'shp',
          features: norm.features,
          fields: inferLayerMeta(norm.features).fields,
          sourceCrs: res.code,
          warnings,
        }
      }
      sourceCrs = res.code
    } else if (!res.code && !res.def) {
      warnings.push('无法识别 .prj 内容，按 EPSG:4326 解析')
    }
  } else {
    // 无 .prj：检查是否像 CGCS2000 带号坐标
    const first = features.find((f) => f.geometry)
    const c = first ? firstCoord(first.geometry) : null
    const [x, y] = c ?? [0, 0]
    if (Math.abs(x) > 1e7 && x > 1.3e7 && x < 2.4e7) {
      const zone = inferCgcsZone(x, y)
      if (zone) {
        const norm = normalizeToWgs84(features, zone)
        if (norm.converted) {
          warnings.push(`未找到 .prj，按 ${zone}（CGCS2000 带号推断）解析`)
          return {
            kind: 'vector',
            name: stem,
            format: 'shp',
            features: norm.features,
            fields: inferLayerMeta(norm.features).fields,
            sourceCrs: zone,
            warnings,
          }
        }
        sourceCrs = zone
      }
    }
    warnings.push('未找到 .prj，按 EPSG:4326 解析')
  }

  return {
    kind: 'vector',
    name: stem,
    format: 'shp',
    features,
    fields: inferLayerMeta(features).fields,
    sourceCrs,
    warnings,
  }
}
