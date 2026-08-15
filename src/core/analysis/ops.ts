/**
 * 空间分析算子：纯函数实现，运行在 Web Worker 中。
 * 每个算子签名统一为 (op, layers) => AnalysisOutcome：
 *  - 找不到 layerId 返回 { ok:false, error:'找不到图层' }
 *  - 要素为空返回空结果（不报错）
 *  - 内部 try/catch，异常返回 { ok:false, error: String(e) }，绝不抛出
 *
 * 注意：turf v7 的 intersect / union / difference 均接收「单个」FeatureCollection
 * 并对其全部要素做整体运算，因此双图层算子把 A、B 合并为同一集合后调用。
 */
import type { Feature, MultiPolygon, Point, Polygon } from 'geojson'
import { featureCollection, polygon, round } from '@turf/helpers'
import type { Units } from '@turf/helpers'
import buffer from '@turf/buffer'
import intersect from '@turf/intersect'
import union from '@turf/union'
import difference from '@turf/difference'
import dissolve from '@turf/dissolve'
import centroid from '@turf/centroid'
import area from '@turf/area'
import length from '@turf/length'
import bbox from '@turf/bbox'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { AnalysisOp, AnalysisOutcome, AnalysisTableResult } from './types'
import { inferLayerMeta } from '@/core/layers/model'

type Layers = Record<string, Feature[]>

const NOT_FOUND = '找不到图层'

function findLayer(layers: Layers, id: string): Feature[] | null {
  return Object.prototype.hasOwnProperty.call(layers, id) ? layers[id] : null
}

function err(message: string): AnalysisOutcome {
  return { ok: false, error: message }
}

function tableOutcome(name: string, table: AnalysisTableResult): AnalysisOutcome {
  return { ok: true, kind: 'table', name, table }
}

/** 输出 vector 结果：保留既有 id（无则 f_<index>），用 inferLayerMeta 计算 fields */
function vectorOutcome(name: string, features: Feature[]): AnalysisOutcome {
  const withIds = features.map((f, i) =>
    f.id !== undefined && f.id !== null ? f : { ...f, id: `f_${i}` },
  )
  return {
    ok: true,
    kind: 'vector',
    name,
    features: withIds,
    fields: inferLayerMeta(withIds).fields,
  }
}

function guard(fn: () => AnalysisOutcome): AnalysisOutcome {
  try {
    return fn()
  } catch (e) {
    return err(String(e))
  }
}

function isPolygonLike(f: Feature): f is Feature<Polygon | MultiPolygon> {
  const t = f.geometry?.type
  return t === 'Polygon' || t === 'MultiPolygon'
}

function allPolygonLike(features: Feature[]): features is Feature<Polygon | MultiPolygon>[] {
  return features.every(isPolygonLike)
}

/** buffer：@turf/buffer(fc, distance, { units, dissolve }) */
export function opBuffer(op: Extract<AnalysisOp, { op: 'buffer' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    if (feats === null) return err(NOT_FOUND)
    if (feats.length === 0) return vectorOutcome(op.op, [])
    const options: { units: Units; steps?: number; dissolve?: boolean } = {
      units: op.unit,
      dissolve: op.dissolve,
    }
    const buffered = buffer(featureCollection(feats), op.distance, options)
    if (!buffered) return vectorOutcome(op.op, [])
    const result: Feature[] = 'features' in buffered ? buffered.features : [buffered as Feature]
    return vectorOutcome(op.op, result)
  })
}

/**
 * intersect / clip(面) 共用。
 * turf v7 的 intersect(fc) 计算的是"集合内所有几何的公共交集"，
 * 因此按要素对（A × B）逐对求交，符合 QGIS 叠加语义。
 */
function intersectCore(name: string, layerA: string, layerB: string, layers: Layers): AnalysisOutcome {
  const a = findLayer(layers, layerA)
  const b = findLayer(layers, layerB)
  if (a === null || b === null) return err(NOT_FOUND)
  if (a.length === 0 || b.length === 0) return vectorOutcome(name, [])
  if (!allPolygonLike(a) || !allPolygonLike(b)) return err('相交仅支持面图层')
  const out: Feature[] = []
  for (const fa of a) {
    for (const fb of b) {
      const r = intersect(featureCollection([fa, fb]))
      if (r) out.push(r)
    }
  }
  return vectorOutcome(name, out)
}

/** intersect：仅面图层 */
export function opIntersect(op: Extract<AnalysisOp, { op: 'intersect' }>, layers: Layers): AnalysisOutcome {
  return guard(() => intersectCore(op.op, op.layerA, op.layerB, layers))
}

/** union：仅面图层 */
export function opUnion(op: Extract<AnalysisOp, { op: 'union' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const a = findLayer(layers, op.layerA)
    const b = findLayer(layers, op.layerB)
    if (a === null || b === null) return err(NOT_FOUND)
    if (a.length === 0 || b.length === 0) return vectorOutcome(op.op, [])
    if (!allPolygonLike(a) || !allPolygonLike(b)) return err('联合仅支持面图层')
    const result = union(featureCollection([...a, ...b]))
    return vectorOutcome(op.op, result ? [result] : [])
  })
}

/**
 * difference：仅面图层，A 减 B。
 * turf v7 difference(fc) 语义为"第一个几何减去其余几何"，
 * 因此对 A 中每个要素分别减去全部 B 要素（= 该要素减 B 的并集）。
 */
export function opDifference(op: Extract<AnalysisOp, { op: 'difference' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const a = findLayer(layers, op.layerA)
    const b = findLayer(layers, op.layerB)
    if (a === null || b === null) return err(NOT_FOUND)
    if (a.length === 0 || b.length === 0) return vectorOutcome(op.op, [])
    if (!allPolygonLike(a) || !allPolygonLike(b)) return err('差集仅支持面图层')
    const out: Feature[] = []
    for (const fa of a) {
      const r = difference(featureCollection([fa, ...b]))
      if (r) out.push(r)
    }
    return vectorOutcome(op.op, out)
  })
}

/** clip：按要素类型分发（点 / 面 / 线） */
export function opClip(op: Extract<AnalysisOp, { op: 'clip' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    const clipFeats = findLayer(layers, op.clipLayerId)
    if (feats === null || clipFeats === null) return err(NOT_FOUND)
    if (feats.length === 0 || clipFeats.length === 0) return vectorOutcome(op.op, [])

    const types = new Set<string>()
    for (const f of feats) {
      if (f.geometry) types.add(f.geometry.type)
    }
    if (types.has('LineString') || types.has('MultiLineString')) return err('裁剪线要素暂不支持')

    // 面：同 intersect
    if (types.has('Polygon') || types.has('MultiPolygon')) {
      return intersectCore(op.op, op.layerId, op.clipLayerId, layers)
    }

    // 点：boolean-point-in-polygon 逐个过滤，保留原属性
    const clipPolys = clipFeats.filter(isPolygonLike)
    const kept: Feature[] = []
    for (const f of feats) {
      const g = f.geometry
      if (!g) continue
      if (g.type === 'Point') {
        if (clipPolys.some((p) => booleanPointInPolygon(f as Feature<Point>, p))) kept.push(f)
      } else if (g.type === 'MultiPoint') {
        const inside = g.coordinates.filter((c) => clipPolys.some((p) => booleanPointInPolygon(c, p)))
        if (inside.length > 0) kept.push({ ...f, geometry: { type: 'MultiPoint', coordinates: inside } })
      }
    }
    return vectorOutcome(op.op, kept)
  })
}

/**
 * dissolve：@turf/dissolve(fc, { propertyName: field })（field 缺省不传）。
 * turf v7 dissolve 对部分输入（空集合、MultiPolygon、非简单面）会抛错，
 * 报错时走手动兜底：按 field 分组（无 field 时全为一组），组内用 union 逐要素合并，
 * 属性取组首；MultiPolygon 结果按部件拆分为独立 Polygon。
 */
export function opDissolve(op: Extract<AnalysisOp, { op: 'dissolve' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    if (feats === null) return err(NOT_FOUND)
    if (feats.length === 0) return vectorOutcome(op.op, [])
    let result: Feature[]
    try {
      const fc = featureCollection(feats as Feature<Polygon>[])
      const dissolved = op.field ? dissolve(fc, { propertyName: op.field }) : dissolve(fc)
      result = dissolved.features
    } catch {
      result = dissolveFallback(feats, op.field)
    }
    return vectorOutcome(op.op, result)
  })
}

/** dissolve 手动兜底：分组 + 组内 union 逐要素合并 */
function dissolveFallback(feats: Feature[], field?: string): Feature[] {
  const groups = new Map<unknown, Feature[]>()
  if (field) {
    for (const f of feats) {
      const key = (f.properties ?? {})[field]
      const list = groups.get(key)
      if (list) list.push(f)
      else groups.set(key, [f])
    }
  } else {
    groups.set(undefined, feats)
  }

  const out: Feature[] = []
  for (const group of groups.values()) {
    if (group.length === 0) continue
    const props = group[0].properties ?? {}
    let merged: Feature<Polygon | MultiPolygon> | null = group[0] as Feature<Polygon | MultiPolygon>
    for (let i = 1; i < group.length; i++) {
      const next = group[i] as Feature<Polygon | MultiPolygon>
      merged = union(featureCollection([merged, next]))
      if (merged === null) break
    }
    if (merged === null) continue
    if (merged.geometry.type === 'MultiPolygon') {
      for (const coords of merged.geometry.coordinates) {
        out.push(polygon(coords, { ...props }))
      }
    } else {
      out.push({ ...merged, properties: { ...props } })
    }
  }
  return out
}

/** centroid：每个要素求质心，保留原属性 */
export function opCentroid(op: Extract<AnalysisOp, { op: 'centroid' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    if (feats === null) return err(NOT_FOUND)
    if (feats.length === 0) return vectorOutcome(op.op, [])
    const out = feats.map((f) => {
      const c = centroid(f)
      return { ...c, id: f.id, properties: { ...(f.properties ?? {}) } }
    })
    return vectorOutcome(op.op, out)
  })
}

/** fieldStats：数值字段统计（样本标准差） */
export function opFieldStats(op: Extract<AnalysisOp, { op: 'fieldStats' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    if (feats === null) return err(NOT_FOUND)
    if (feats.length === 0) return tableOutcome(op.op, { columns: ['统计项', '值'], rows: [] })

    const values: number[] = []
    let nullCount = 0
    for (const f of feats) {
      const v = (f.properties ?? {})[op.field]
      if (v === null || v === undefined) {
        nullCount += 1
        continue
      }
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
    }
    if (values.length === 0) return err('字段不含数值')

    const count = values.length
    const sum = values.reduce((acc, v) => acc + v, 0)
    const mean = sum / count
    const min = Math.min(...values)
    const max = Math.max(...values)
    const variance = count > 1 ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (count - 1) : 0
    const stdDev = Math.sqrt(variance)

    const rows: (string | number | null)[][] = [
      ['计数', count],
      ['空值', nullCount],
      ['求和', sum],
      ['平均', mean],
      ['最小', min],
      ['最大', max],
      ['标准差', stdDev],
    ]
    return tableOutcome(op.op, { columns: ['统计项', '值'], rows })
  })
}

/** layerStats：图层统计 */
export function opLayerStats(op: Extract<AnalysisOp, { op: 'layerStats' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    if (feats === null) return err(NOT_FOUND)
    if (feats.length === 0) return tableOutcome(op.op, { columns: ['统计项', '值'], rows: [] })

    let pointCount = 0
    let lineCount = 0
    let polygonCount = 0
    let mixedCount = 0
    const polygons: Feature[] = []
    const lines: Feature[] = []
    for (const f of feats) {
      const t = f.geometry?.type
      if (t === 'Point' || t === 'MultiPoint') pointCount += 1
      else if (t === 'LineString' || t === 'MultiLineString') {
        lineCount += 1
        lines.push(f)
      } else if (t === 'Polygon' || t === 'MultiPolygon') {
        polygonCount += 1
        polygons.push(f)
      } else {
        // GeometryCollection / 空几何 / 未知类型
        mixedCount += 1
      }
    }

    const withGeom = feats.filter((f) => f.geometry !== null)
    let totalArea = 0
    if (polygons.length > 0) totalArea = area(featureCollection(polygons))
    let totalLength = 0
    if (lines.length > 0) totalLength = length(featureCollection(lines), { units: 'kilometers' })
    const extent =
      withGeom.length > 0
        ? (() => {
            const [minX, minY, maxX, maxY] = bbox(featureCollection(withGeom))
            return `${minX.toFixed(6)}, ${minY.toFixed(6)}, ${maxX.toFixed(6)}, ${maxY.toFixed(6)}`
          })()
        : '0.000000, 0.000000, 0.000000, 0.000000'

    const rows: (string | number | null)[][] = [
      ['要素数', feats.length],
      ['点', pointCount],
      ['线', lineCount],
      ['面', polygonCount],
      ['混合', mixedCount],
      ['总面积 (m²)', Number(totalArea.toFixed(2))],
      ['总长度 (km)', totalLength],
      ['外包矩形', extent],
    ]
    return tableOutcome(op.op, { columns: ['统计项', '值'], rows })
  })
}

/** bbox：生成外接矩形 Polygon 要素 */
export function opBbox(op: Extract<AnalysisOp, { op: 'bbox' }>, layers: Layers): AnalysisOutcome {
  return guard(() => {
    const feats = findLayer(layers, op.layerId)
    if (feats === null) return err(NOT_FOUND)
    if (feats.length === 0) return vectorOutcome(op.op, [])
    const [minX, minY, maxX, maxY] = bbox(featureCollection(feats))
    const rect = polygon(
      [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
      { sourceLayer: op.layerId, width: round(maxX - minX, 6), height: round(maxY - minY, 6) },
    )
    return vectorOutcome(op.op, [rect])
  })
}

/** 算子分发（worker 入口） */
export function runAnalysisOp(op: AnalysisOp, layers: Layers): AnalysisOutcome {
  switch (op.op) {
    case 'buffer':
      return opBuffer(op, layers)
    case 'intersect':
      return opIntersect(op, layers)
    case 'union':
      return opUnion(op, layers)
    case 'difference':
      return opDifference(op, layers)
    case 'clip':
      return opClip(op, layers)
    case 'dissolve':
      return opDissolve(op, layers)
    case 'centroid':
      return opCentroid(op, layers)
    case 'fieldStats':
      return opFieldStats(op, layers)
    case 'layerStats':
      return opLayerStats(op, layers)
    case 'bbox':
      return opBbox(op, layers)
  }
}
