/**
 * 引擎无关的图层模型（类似 QGIS 的图层树节点）。
 * 业务层统一持有 EPSG:4326 几何；坐标系元信息保留在 sourceCrs 中。
 */
import type { Feature } from 'geojson'
import type { LayerStyle } from '@/core/style/types'

export type LayerKind = 'vector' | 'raster'
export type VectorGeometryType = 'Point' | 'LineString' | 'Polygon' | 'Mixed' | 'None'

export interface FieldInfo {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'null'
  /** 非空值采样数量 */
  sampleCount?: number
}

/** 本地文件引用：可写回磁盘的来源文件 */
export interface LocalFileRef {
  name: string
  /** 相对工程目录的路径（来自 File System Access 目录时有效） */
  relativePath?: string
  size?: number
  /** 是否位于工程目录内（可自动写回） */
  inProjectDir?: boolean
}

export interface BaseLayerModel {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  opacity: number
  zIndex: number
  createdAt: number
  updatedAt: number
}

export interface VectorLayerModel extends BaseLayerModel {
  kind: 'vector'
  geometryType: VectorGeometryType
  features: Feature[]
  fields: FieldInfo[]
  style: LayerStyle
  sourceCrs?: string
  sourceFile?: LocalFileRef
  format?: 'geojson' | 'shp' | 'kml' | 'gpx' | 'csv'
  editable: boolean
  /** 属性表 UI 状态（排序/筛选） */
  tableState?: { sortBy?: string; sortDir?: 'asc' | 'desc'; filter?: string }
}

export interface RasterLayerModel extends BaseLayerModel {
  kind: 'raster'
  source: {
    kind: 'geotiff'
    data: ArrayBuffer
    crs?: string
    width?: number
    height?: number
    bands?: number
  }
  sourceFile?: LocalFileRef
  format?: 'geotiff'
}

export type LayerModel = VectorLayerModel | RasterLayerModel

export function isVectorLayer(layer: LayerModel): layer is VectorLayerModel {
  return layer.kind === 'vector'
}

export function isRasterLayer(layer: LayerModel): layer is RasterLayerModel {
  return layer.kind === 'raster'
}

/** 从要素集合推断几何类型与字段 */
export function inferLayerMeta(features: Feature[]): {
  geometryType: VectorGeometryType
  fields: FieldInfo[]
} {
  const types = new Set<string>()
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    const t = g.type
    if (t === 'MultiPoint') types.add('Point')
    else if (t === 'MultiLineString') types.add('LineString')
    else if (t === 'MultiPolygon' || t === 'Polygon') types.add('Polygon')
    else types.add(t)
  }
  let geometryType: VectorGeometryType = 'None'
  if (types.size === 1) geometryType = [...types][0] as VectorGeometryType
  else if (types.size > 1) geometryType = 'Mixed'

  const fieldMap = new Map<string, Map<string, number>>()
  const fieldCount = new Map<string, number>()
  const MAX_SAMPLES = 1000
  for (let i = 0; i < Math.min(features.length, MAX_SAMPLES); i++) {
    const props = features[i].properties ?? {}
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined) continue
      if (!fieldMap.has(k)) fieldMap.set(k, new Map())
      fieldMap.get(k)!.set(typeof v, (fieldMap.get(k)!.get(typeof v) ?? 0) + 1)
      fieldCount.set(k, (fieldCount.get(k) ?? 0) + 1)
    }
  }
  const fields: FieldInfo[] = [...fieldMap.entries()]
    .map(([name, typeCounts]) => {
      const [topType] = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]
      let type: FieldInfo['type'] = 'string'
      if (topType === 'number') type = 'number'
      else if (topType === 'boolean') type = 'boolean'
      return { name, type, sampleCount: fieldCount.get(name) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return { geometryType, fields }
}

/** 简单 ID 生成 */
export function uid(prefix = 'lyr'): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}
