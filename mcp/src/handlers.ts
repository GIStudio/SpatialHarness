/**
 * 工具处理器：每个 MCP 工具对应一个纯函数 (store, args) => ToolResult。
 * 与传输层解耦，可直接单测；index.ts 负责注册到 McpServer。
 */
import type { Feature } from 'geojson'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { runAnalysisOp } from '@/core/analysis/ops'
import type { AnalysisOp, AnalysisOutcome, BufferUnit } from '@/core/analysis/types'
import { resultLayerName } from '@/core/analysis/types'
import { exportVector } from '@/core/datasource/exporters'
import type { VectorGeometryType } from '@/core/layers/model'
import { DatasetStore } from './registry'
import { loadDataset } from './load'
import { geojsonOf, summarize } from './summary'

export type ToolResult = CallToolResult

export function textResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) }
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `错误：${message}` }], isError: true }
}

const MISSING_BOTH = '必须提供 layer_id（已加载数据集）或 geojson（内联 FeatureCollection），二选一'

/** 解析图层引用：layer_id 优先，否则内联 geojson */
export function resolveFeatures(store: DatasetStore, args: { layer_id?: string; geojson?: unknown }): { features: Feature[]; key: string; name: string } {
  if (args.layer_id) {
    const ds = store.get(args.layer_id)
    if (!ds) {
      const hint = store.size > 0 ? `可用数据集：${store.list().map((d) => d.id).join(', ')}` : '当前没有已加载的数据集，请先调用 load_dataset'
      throw new Error(`数据集 ${args.layer_id} 不存在（${hint}）`)
    }
    return { features: ds.features, key: ds.id, name: ds.name }
  }
  if (args.geojson) {
    const fc = args.geojson as { type?: string; features?: unknown }
    if (fc?.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
      throw new Error('geojson 必须是 { type: "FeatureCollection", features: [...] }')
    }
    return { features: fc.features as Feature[], key: 'inline', name: 'inline' }
  }
  throw new Error(MISSING_BOTH)
}

function resolveTwo(
  store: DatasetStore,
  args: { layer_a_id?: string; layer_a_geojson?: unknown; layer_b_id?: string; layer_b_geojson?: unknown },
): { a: { features: Feature[]; key: string; name: string }; b: { features: Feature[]; key: string; name: string } } {
  const a = resolveFeatures(store, { layer_id: args.layer_a_id, geojson: args.layer_a_geojson })
  const b = resolveFeatures(store, { layer_id: args.layer_b_id, geojson: args.layer_b_geojson })
  return {
    a: { features: a.features, key: a.key, name: a.name },
    b: { features: b.features, key: b.key, name: b.name },
  }
}

interface VectorResultOptions {
  store: DatasetStore
  outcome: AnalysisOutcome
  includeGeojson?: boolean
}

/** vector 结果 → 自动注册新数据集 + 摘要；table 结果 → 表格 */
function outcomeToResult({ store, outcome, includeGeojson }: VectorResultOptions): ToolResult {
  if (!outcome.ok) return errorResult(outcome.error)
  if (outcome.kind === 'table') {
    const text = [outcome.table.columns.join(' | '), ...outcome.table.rows.map((r) => r.join(' | '))].join('\n')
    return textResult(`统计表（${outcome.name}）：\n${text}`, {
      name: outcome.name,
      columns: outcome.table.columns,
      rows: outcome.table.rows,
    })
  }
  const ds = store.add({
    name: outcome.name,
    format: 'geojson',
    features: outcome.features,
    fields: outcome.fields,
    geometryType: inferVectorGeometryType(outcome.features),
    sourceCrs: outcome.sourceCrs,
    warnings: [],
  })
  const summary = summarize(ds)
  let text = `已生成数据集 ${ds.id}「${ds.name}」：${ds.features.length} 个要素（${ds.geometryType}）`
  if (summary.bbox) text += `，外包矩形 ${summary.bbox.map((v) => Number(v.toFixed(6))).join(', ')}`
  if (ds.fields.length > 0) text += `，字段：${ds.fields.map((f) => f.name).join(', ')}`
  if (includeGeojson) {
    const { text: geojson, truncated } = geojsonOf(ds.features)
    text += `\nGeoJSON：\n${geojson}${truncated ? '（已截断）' : ''}`
    return textResult(text, { ...summary, geojson: truncated ? undefined : JSON.parse(geojson) })
  }
  return textResult(text, { ...summary })
}

function inferVectorGeometryType(features: Feature[]): VectorGeometryType {
  const types = new Set<string>()
  for (const f of features) {
    const t = f.geometry?.type
    if (!t) continue
    if (t === 'MultiPoint') types.add('Point')
    else if (t === 'MultiLineString') types.add('LineString')
    else if (t === 'MultiPolygon') types.add('Polygon')
    else types.add(t)
  }
  if (types.size === 0) return 'None'
  if (types.size === 1) return [...types][0] as VectorGeometryType
  return 'Mixed'
}

/* ------------------------------ 数据集管理 ------------------------------ */

export async function handleLoadDataset(store: DatasetStore, args: { path?: string; name?: string; data?: string; encoding?: string }): Promise<ToolResult> {
  try {
    const result = await loadDataset(store, args)
    const lines: string[] = []
    if (result.loaded.length > 0) {
      lines.push('已加载：')
      for (const s of result.loaded) lines.push(`  ${s.layer_id}「${s.name}」 ${s.format} ${s.feature_count} 要素 ${s.geometry_type}`)
    }
    if (result.raster.length > 0) {
      lines.push('栅格（仅元信息，不支持分析）：')
      for (const r of result.raster) lines.push(`  ${r.name} ${r.width}×${r.height} ${r.bands} 波段${r.crs ? ` ${r.crs}` : ''}`)
    }
    if (result.warnings.length > 0) lines.push(`警告：${result.warnings.join('；')}`)
    if (lines.length === 0) lines.push('未解析出任何数据')
    return textResult(lines.join('\n'), { loaded: result.loaded, raster: result.raster, warnings: result.warnings })
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
}

export function handleListDatasets(store: DatasetStore): ToolResult {
  const all = store.list()
  if (all.length === 0) return textResult('当前没有已加载的数据集。先用 load_dataset 加载本地 GIS 文件，或用 buffer/intersect 等分析工具生成新数据集。', { datasets: [] })
  const lines = all.map((d) => `${d.id}「${d.name}」 ${d.format} ${d.features.length} 要素 ${d.geometryType}`)
  return textResult(lines.join('\n'), { datasets: all.map(summarize) })
}

export function handleGetDataset(store: DatasetStore, args: { layer_id?: string; include_geojson?: boolean }): ToolResult {
  try {
    const ref = resolveFeatures(store, { layer_id: args.layer_id })
    const summary = summarize(store.get(ref.key)!)
    let text = `数据集 ${summary.layer_id}「${summary.name}」 ${summary.format} ${summary.feature_count} 要素 ${summary.geometry_type}`
    if (summary.bbox) text += `，外包矩形 ${summary.bbox.map((v) => Number(v.toFixed(6))).join(', ')}`
    if (summary.fields.length > 0) text += `\n字段：${summary.fields.map((f) => `${f.name}(${f.type})`).join(', ')}`
    if (args.include_geojson) {
      const { text: geojson, truncated } = geojsonOf(ref.features)
      text += `\nGeoJSON：\n${geojson}${truncated ? '（已截断）' : ''}`
      return textResult(text, { ...summary, geojson: truncated ? undefined : JSON.parse(geojson) })
    }
    return textResult(text, { ...summary })
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
}

export function handleUnloadDataset(store: DatasetStore, args: { layer_id: string }): ToolResult {
  if (!args.layer_id) return errorResult('必须提供 layer_id')
  const removed = store.remove(args.layer_id)
  if (!removed) return errorResult(`数据集 ${args.layer_id} 不存在`)
  return textResult(`已移除数据集 ${args.layer_id}，剩余 ${store.size} 个`, { removed: args.layer_id, remaining: store.size })
}

/* ------------------------------ 空间分析 ------------------------------ */

const UNITS: BufferUnit[] = ['meters', 'kilometers', 'miles']

function runVectorOp(
  store: DatasetStore,
  build: () => { op: AnalysisOp; layers: Record<string, Feature[]>; names: Record<string, string> },
  includeGeojson?: boolean,
): ToolResult {
  let outcome: AnalysisOutcome
  try {
    const { op, layers, names } = build()
    outcome = runAnalysisOp(op, layers)
    // 与 Web 端一致：结果图层使用语义化命名（如「缓冲区_L1_100m」）
    if (outcome.ok) outcome = { ...outcome, name: resultLayerName(op, names) }
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
  return outcomeToResult({ store, outcome, includeGeojson })
}

export function handleBuffer(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; distance: number; unit?: BufferUnit; dissolve?: boolean; include_geojson?: boolean },
): ToolResult {
  if (typeof args.distance !== 'number' || !Number.isFinite(args.distance)) return errorResult('distance 必须是数字')
  const unit = args.unit ?? 'meters'
  if (!UNITS.includes(unit)) return errorResult(`unit 必须是 ${UNITS.join(' / ')}`)
  return runVectorOp(store, () => {
    const ref = resolveFeatures(store, args)
    const op: AnalysisOp = { op: 'buffer', layerId: ref.key, distance: args.distance, unit, dissolve: args.dissolve }
    return { op, layers: { [ref.key]: ref.features }, names: { [ref.key]: ref.name } }
  }, args.include_geojson)
}

export function handleIntersect(
  store: DatasetStore,
  args: { layer_a_id?: string; layer_a_geojson?: unknown; layer_b_id?: string; layer_b_geojson?: unknown; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const { a, b } = resolveTwo(store, args)
    const op: AnalysisOp = { op: 'intersect', layerA: a.key, layerB: b.key }
    return { op, layers: { [a.key]: a.features, [b.key]: b.features }, names: { [a.key]: a.name, [b.key]: b.name } }
  }, args.include_geojson)
}

export function handleUnion(
  store: DatasetStore,
  args: { layer_a_id?: string; layer_a_geojson?: unknown; layer_b_id?: string; layer_b_geojson?: unknown; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const { a, b } = resolveTwo(store, args)
    const op: AnalysisOp = { op: 'union', layerA: a.key, layerB: b.key }
    return { op, layers: { [a.key]: a.features, [b.key]: b.features }, names: { [a.key]: a.name, [b.key]: b.name } }
  }, args.include_geojson)
}

export function handleDifference(
  store: DatasetStore,
  args: { layer_a_id?: string; layer_a_geojson?: unknown; layer_b_id?: string; layer_b_geojson?: unknown; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const { a, b } = resolveTwo(store, args)
    const op: AnalysisOp = { op: 'difference', layerA: a.key, layerB: b.key }
    return { op, layers: { [a.key]: a.features, [b.key]: b.features }, names: { [a.key]: a.name, [b.key]: b.name } }
  }, args.include_geojson)
}

export function handleClip(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; clip_layer_id?: string; clip_layer_geojson?: unknown; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const target = resolveFeatures(store, { layer_id: args.layer_id, geojson: args.geojson })
    const clip = resolveFeatures(store, { layer_id: args.clip_layer_id, geojson: args.clip_layer_geojson })
    const op: AnalysisOp = { op: 'clip', layerId: target.key, clipLayerId: clip.key }
    return {
      op,
      layers: { [target.key]: target.features, [clip.key]: clip.features },
      names: { [target.key]: target.name, [clip.key]: clip.name },
    }
  }, args.include_geojson)
}

export function handleDissolve(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; field?: string; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const ref = resolveFeatures(store, args)
    const op: AnalysisOp = { op: 'dissolve', layerId: ref.key, field: args.field }
    return { op, layers: { [ref.key]: ref.features }, names: { [ref.key]: ref.name } }
  }, args.include_geojson)
}

export function handleCentroid(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const ref = resolveFeatures(store, args)
    const op: AnalysisOp = { op: 'centroid', layerId: ref.key }
    return { op, layers: { [ref.key]: ref.features }, names: { [ref.key]: ref.name } }
  }, args.include_geojson)
}

export function handleBbox(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; include_geojson?: boolean },
): ToolResult {
  return runVectorOp(store, () => {
    const ref = resolveFeatures(store, args)
    const op: AnalysisOp = { op: 'bbox', layerId: ref.key }
    return { op, layers: { [ref.key]: ref.features }, names: { [ref.key]: ref.name } }
  }, args.include_geojson)
}

export function handleFieldStats(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; field: string },
): ToolResult {
  if (!args.field) return errorResult('必须提供 field（要统计的数值字段名）')
  return runVectorOp(store, () => {
    const ref = resolveFeatures(store, args)
    const op: AnalysisOp = { op: 'fieldStats', layerId: ref.key, field: args.field }
    return { op, layers: { [ref.key]: ref.features }, names: { [ref.key]: ref.name } }
  })
}

export function handleLayerStats(store: DatasetStore, args: { layer_id?: string; geojson?: unknown }): ToolResult {
  return runVectorOp(store, () => {
    const ref = resolveFeatures(store, args)
    const op: AnalysisOp = { op: 'layerStats', layerId: ref.key }
    return { op, layers: { [ref.key]: ref.features }, names: { [ref.key]: ref.name } }
  })
}

/* ------------------------------ 导出 ------------------------------ */

const TEXT_MAX = 1_000_000

export async function handleConvertFormat(
  store: DatasetStore,
  args: { layer_id?: string; geojson?: unknown; format: 'geojson' | 'csv' | 'kml' | 'shp' | 'gpx' | 'gpkg'; layer_name?: string },
): Promise<ToolResult> {
  if (!['geojson', 'csv', 'kml', 'shp', 'gpx', 'gpkg'].includes(args.format)) return errorResult('format 必须是 geojson / csv / kml / shp / gpx / gpkg')
  try {
    const ref = resolveFeatures(store, args)
    const layerName = args.layer_name ?? (args.layer_id ? store.get(args.layer_id)?.name : 'inline') ?? 'layer'
    const exported = await exportVector({ features: ref.features, format: args.format, layerName })
    const warnText = exported.warnings?.length ? `\n警告：${exported.warnings.join('；')}` : ''

    if (args.format === 'shp' || args.format === 'gpkg') {
      // 二进制（Shapefile zip / GeoPackage SQLite）：以 base64 文本返回
      const bytes = new Uint8Array(await exported.blob.arrayBuffer())
      const base64 = Buffer.from(bytes).toString('base64')
      const shown = base64.length > TEXT_MAX ? base64.slice(0, TEXT_MAX) + `\n…（已截断，完整 base64 共 ${base64.length} 字符）` : base64
      const kindLabel =
        args.format === 'shp' ? 'Shapefile = shp+shx+dbf+prj+cpg，属性 UTF-8 编码' : 'GeoPackage（SQLite，EPSG:4326）'
      return textResult(
        `已导出 ${exported.fileName}（${bytes.length} 字节，${kindLabel}）${warnText}\nbase64：\n${shown}`,
        { file_name: exported.fileName, format: args.format, encoding: 'base64', byte_length: bytes.length, content: base64, warnings: exported.warnings ?? [] },
      )
    }

    const content = await exported.blob.text()
    const shown = content.length > TEXT_MAX ? content.slice(0, TEXT_MAX) + `\n…（已截断，完整内容 ${content.length} 字符）` : content
    return textResult(`已导出 ${exported.fileName}（${content.length} 字符）：${warnText}\n${shown}`, {
      file_name: exported.fileName,
      format: args.format,
      content,
      warnings: exported.warnings ?? [],
    })
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e))
  }
}
