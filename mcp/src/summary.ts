/**
 * 数据集摘要与 GeoJSON 序列化工具（MCP 结果展示层）。
 */
import type { Feature } from 'geojson'
import { featureCollection } from '@turf/helpers'
import bbox from '@turf/bbox'
import type { StoredDataset } from './registry'

export interface DatasetSummary {
  layer_id: string
  name: string
  format: string
  feature_count: number
  geometry_type: string
  fields: { name: string; type: string }[]
  bbox: [number, number, number, number] | null
  source_crs?: string
}

export function summarize(ds: StoredDataset): DatasetSummary {
  const extent = ds.features.length > 0 ? (bbox(featureCollection(ds.features)) as [number, number, number, number]) : null
  return {
    layer_id: ds.id,
    name: ds.name,
    format: ds.format,
    feature_count: ds.features.length,
    geometry_type: ds.geometryType,
    fields: ds.fields.map((f) => ({ name: f.name, type: f.type })),
    bbox: extent,
    ...(ds.sourceCrs ? { source_crs: ds.sourceCrs } : {}),
  }
}

/** 序列化 FeatureCollection；超出长度上限时截断并附说明，避免撑爆协议消息 */
export function geojsonOf(features: Feature[], maxChars = 2_000_000): { text: string; truncated: boolean } {
  const fc = { type: 'FeatureCollection', features }
  const raw = JSON.stringify(fc)
  if (raw.length <= maxChars) return { text: raw, truncated: false }
  return { text: raw.slice(0, maxChars) + `\n…（已截断，完整数据 ${raw.length} 字符）`, truncated: true }
}
