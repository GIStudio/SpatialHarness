/**
 * GeoJSON 文本解析：支持 FeatureCollection / 单个 Feature / 裸 Geometry。
 * 返回的几何即为 4326（GeoJSON 规范约定），无需坐标系归一化。
 */
import type { Feature, Geometry } from 'geojson'
import type { ParsedVectorData } from '../types'
import { inferLayerMeta } from '@/core/layers/model'

const GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
])

export function parseGeoJson(text: string, name: string): ParsedVectorData {
  // 空数据 → 空 FeatureCollection（不视为解析错误）
  if (text.trim() === '') {
    return {
      kind: 'vector',
      name,
      format: 'geojson',
      features: [],
      fields: [],
      warnings: ['GeoJSON 中未找到要素'],
    }
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`GeoJSON 解析失败：${err instanceof Error ? err.message : String(err)}`)
  }

  let features: Feature[] = []
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.type === 'FeatureCollection' && Array.isArray(d.features)) {
      features = d.features as Feature[]
    } else if (d.type === 'Feature') {
      features = [d as unknown as Feature]
    } else if (typeof d.type === 'string' && GEOMETRY_TYPES.has(d.type)) {
      // 裸 Geometry（含 GeometryCollection）
      features = [{ type: 'Feature', properties: {}, geometry: d as unknown as Geometry }]
    } else {
      throw new Error('GeoJSON 结构无法识别（既非 FeatureCollection，也非 Feature/Geometry）')
    }
  }

  const warnings: string[] = []
  if (features.length === 0) warnings.push('GeoJSON 中未找到要素')
  return {
    kind: 'vector',
    name,
    format: 'geojson',
    features,
    fields: inferLayerMeta(features).fields,
    warnings,
  }
}
