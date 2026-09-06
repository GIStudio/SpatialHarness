/**
 * AI 辅助编辑（L1）：编辑语义的唯一入口。
 * 每条 AI 编辑命令在此完成 1) GeoJSON/样式校验 2) 组装 Command 压入 history
 * （→ 自动获得撤销/重做与自动保存）3) 产生人类可读 summary。
 * 传输（轮询/回传）在 core/bridge/editClient.ts。见 docs/ai-editing.md。
 */
import { create } from 'zustand'
import type { Feature, Geometry } from 'geojson'
import { fetchPendingEdits, postEditResult, type EditCommandMessage } from '@/core/bridge/editClient'
import { DEFAULT_BRIDGE_URL } from '@/core/bridge/pythonBridge'
import { uid, inferLayerMeta, isVectorLayer, type VectorLayerModel, type VectorGeometryType } from '@/core/layers/model'
import { DEFAULT_PALETTE, type LayerStyle } from '@/core/style/types'
import { useProjectStore } from './project'
import { useHistoryStore, featuresCommand, type Command } from './history'
import { useUiStore } from './ui'
import { useSelectionStore } from './selection'
import { engineFitToLayer, getEngine } from './engineBridge'

const GEOMETRY_KINDS = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'])
const SYMBOL_KEYS = new Set(['kind', 'pointRadius', 'pointSymbol', 'pointColor', 'strokeColor', 'strokeWidth', 'strokeDash', 'fillColor'])

export interface EditOutcome {
  ok: boolean
  summary: string
  error?: string
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function validateFeature(raw: unknown, index: number): Feature {
  if (raw === null || typeof raw !== 'object') throw new Error(`features[${index}] 不是对象`)
  const f = raw as Record<string, unknown>
  if (f.type !== 'Feature') throw new Error(`features[${index}] 缺少 type:'Feature'`)
  const props = f.properties
  if (props !== null && props !== undefined && typeof props !== 'object') {
    throw new Error(`features[${index}].properties 必须是对象或 null`)
  }
  const geom = f.geometry
  if (geom !== null && geom !== undefined) {
    const g = geom as Record<string, unknown>
    if (!GEOMETRY_KINDS.has(String(g.type))) throw new Error(`features[${index}].geometry.type 非法: ${String(g.type)}`)
    if (!Array.isArray(g.coordinates)) throw new Error(`features[${index}].geometry.coordinates 不是数组`)
  }
  return { type: 'Feature', properties: (props ?? {}) as Feature['properties'], geometry: geom as Geometry | null, id: f.id } as Feature
}

export function validateFeatures(raw: unknown): Feature[] {
  if (!Array.isArray(raw)) throw new Error('features 必须是数组')
  return raw.map(validateFeature)
}

/** 校验经纬度（EPSG:4326）并补齐缺失的要素 id */
function sanitizeFeatures(features: Feature[]): Feature[] {
  return features.map((f) => {
    if (f.geometry) {
      const coords: number[] = []
      const walk = (v: unknown) => {
        if (typeof v === 'number') coords.push(v)
        else if (Array.isArray(v)) v.forEach(walk)
      }
      walk((f.geometry as { coordinates?: unknown }).coordinates)
      if (coords.length % 2 !== 0) throw new Error('坐标维度异常（奇数个数字）')
      for (let i = 0; i < coords.length; i += 2) {
        const [lon, lat] = [coords[i], coords[i + 1]]
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('坐标含非有限数值')
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new Error(`坐标越界(需 EPSG:4326): [${lon}, ${lat}]`)
      }
    }
    return f.id != null ? f : { ...f, id: uid('ftr') }
  })
}

export function validateStyle(raw: unknown): LayerStyle {
  if (raw === null || typeof raw !== 'object') throw new Error('style 必须是对象')
  const s = raw as Record<string, unknown>
  const symbol = s.symbol as Record<string, unknown> | undefined
  if (!symbol || symbol.kind !== 'simple') throw new Error("style.symbol.kind 目前仅支持 'simple'")
  for (const k of Object.keys(symbol)) {
    if (!SYMBOL_KEYS.has(k)) throw new Error(`style.symbol 含未知字段: ${k}`)
    if (typeof symbol[k] === 'number' && !Number.isFinite(symbol[k] as number)) {
      throw new Error(`style.symbol.${k} 不是有限数值`)
    }
  }
  return { symbol: symbol as unknown as LayerStyle['symbol'], label: null }
}

function defaultStyle(geometryType: VectorGeometryType): LayerStyle {
  const color = DEFAULT_PALETTE[0]
  if (geometryType === 'Point') {
    return { symbol: { kind: 'simple', pointSymbol: 'circle', pointRadius: 5, pointColor: color }, label: null }
  }
  if (geometryType === 'LineString') {
    return { symbol: { kind: 'simple', strokeColor: color, strokeWidth: 2 }, label: null }
  }
  return { symbol: { kind: 'simple', fillColor: color, strokeColor: color, strokeWidth: 1 }, label: null }
}

function makeVectorLayer(name: string, features: Feature[], style?: LayerStyle): VectorLayerModel {
  const meta = inferLayerMeta(features)
  const now = Date.now()
  return {
    id: uid('lyr'),
    name,
    kind: 'vector',
    geometryType: meta.geometryType,
    features,
    fields: meta.fields,
    style: style ?? defaultStyle(meta.geometryType),
    sourceCrs: 'EPSG:4326',
    visible: true,
    opacity: 1,
    zIndex: useProjectStore.getState().layers.length,
    createdAt: now,
    updatedAt: now,
    editable: true,
  }
}

function pushCommand(cmd: Command): void {
  useHistoryStore.getState().push(cmd)
}

function vectorLayer(layerId: string) {
  const layer = useProjectStore.getState().layers.find((l) => l.id === layerId)
  if (!layer) throw new Error(`图层不存在: ${layerId}`)
  if (!isVectorLayer(layer)) throw new Error(`图层不是矢量图层: ${layerId}`)
  return layer as VectorLayerModel
}

function layerByName(name: string) {
  return useProjectStore
    .getState()
    .layers.find((l) => l.kind === 'vector' && l.name === name) as VectorLayerModel | undefined
}

// ---------------------------------------------------------------------------
// 编辑语义（唯一入口）
// ---------------------------------------------------------------------------

export function applyEditCommand(cmd: EditCommandMessage): EditOutcome {
  try {
    return { ok: true, ...applyTool(cmd.tool, cmd.args ?? {}) }
  } catch (e) {
    return { ok: false, summary: '', error: e instanceof Error ? e.message : String(e) }
  }
}

function applyTool(tool: string, args: Record<string, unknown>): { summary: string } {
  switch (tool) {
    case 'map_status': {
      const s = useProjectStore.getState()
      return { summary: `工程「${s.projectName}」· ${s.layers.length} 图层 · AI 编辑在线` }
    }
    case 'map_get_project': {
      const s = useProjectStore.getState()
      // 摘要返回：图层清单（含 id/要素数）——AI 主要消费对象
      const lines = s.layers.map((l) => {
        const v = l.kind === 'vector' ? ` · ${l.features.length} 要素` : ''
        return `${l.id} | ${l.name} | ${l.kind}${v}`
      })
      return { summary: [`工程「${s.projectName}」视图`, ...lines].join('\n') }
    }
    case 'map_add_features': {
      const features = sanitizeFeatures(validateFeatures(args.features))
      if (features.length === 0) throw new Error('features 为空数组')
      let layer = args.layerId ? vectorLayer(String(args.layerId)) : undefined
      let created = false
      if (!layer) {
        const name = String(args.layerName ?? 'AI 图层')
        layer = layerByName(name) ?? (() => {
          created = true
          return makeVectorLayer(name, features)
        })()
        if (created) {
          const model = layer
          useProjectStore.getState().addLayer(model)
          useSelectionStore.getState().setActiveLayer(model.id)
          pushCommand({
            label: `AI: 新建图层 ${model.name}`,
            undo: () => useProjectStore.getState().removeLayer(model.id),
            redo: () => useProjectStore.getState().addLayer(model),
          })
          return { summary: `新建图层「${model.name}」并添加 ${features.length} 个要素` }
        }
      }
      const before = [...layer.features]
      const after = [...before, ...features]
      useProjectStore.getState().replaceFeatures(layer.id, after)
      pushCommand(featuresCommand(layer.id, `AI: +${features.length} 要素`, before, after))
      return { summary: `向「${layer.name}」添加 ${features.length} 个要素` }
    }
    case 'map_replace_features': {
      const layer = vectorLayer(String(args.layerId))
      const features = sanitizeFeatures(validateFeatures(args.features))
      const before = [...layer.features]
      useProjectStore.getState().replaceFeatures(layer.id, features)
      pushCommand(featuresCommand(layer.id, `AI: 替换 ${features.length} 要素`, before, features))
      return { summary: `替换「${layer.name}」为 ${features.length} 个要素` }
    }
    case 'map_update_features': {
      const layer = vectorLayer(String(args.layerId))
      const incoming = validateFeatures(args.features)
      const byId = new Map(incoming.map((f) => [String(f.id ?? ''), f] as const))
      let touched = 0
      const before = [...layer.features]
      const after = before.map((f) => {
        const patch = byId.get(String(f.id ?? ''))
        if (!patch) return f
        touched++
        return {
          ...f,
          geometry: patch.geometry ?? f.geometry,
          properties: { ...f.properties, ...(patch.properties ?? {}) },
        }
      })
      if (touched === 0) throw new Error('没有 feature.id 匹配到目标图层要素')
      useProjectStore.getState().replaceFeatures(layer.id, after)
      pushCommand(featuresCommand(layer.id, `AI: 更新 ${touched} 要素`, before, after))
      return { summary: `更新「${layer.name}」的 ${touched} 个要素` }
    }
    case 'map_delete_features': {
      const layer = vectorLayer(String(args.layerId))
      const ids = new Set((Array.isArray(args.featureIds) ? args.featureIds : []).map(String))
      const before = [...layer.features]
      const after = before.filter((f) => !ids.has(String(f.id ?? '')))
      if (after.length === before.length) throw new Error('没有匹配到要删除的要素')
      useProjectStore.getState().replaceFeatures(layer.id, after)
      pushCommand(featuresCommand(layer.id, `AI: 删除 ${before.length - after.length} 要素`, before, after))
      return { summary: `从「${layer.name}」删除 ${before.length - after.length} 个要素` }
    }
    case 'map_add_layer': {
      const features = sanitizeFeatures(validateFeatures(args.features))
      const model = makeVectorLayer(String(args.name ?? 'AI 图层'), features, args.style ? validateStyle(args.style) : undefined)
      useProjectStore.getState().addLayer(model)
      useSelectionStore.getState().setActiveLayer(model.id)
      pushCommand({
        label: `AI: 新建图层 ${model.name}`,
        undo: () => useProjectStore.getState().removeLayer(model.id),
        redo: () => useProjectStore.getState().addLayer(model),
      })
      return { summary: `新建图层「${model.name}」（${features.length} 要素）` }
    }
    case 'map_remove_layer': {
      const layer = vectorLayer(String(args.layerId))
      useProjectStore.getState().removeLayer(layer.id)
      pushCommand({
        label: `AI: 删除图层 ${layer.name}`,
        undo: () => useProjectStore.getState().addLayer(layer),
        redo: () => useProjectStore.getState().removeLayer(layer.id),
      })
      return { summary: `删除图层「${layer.name}」` }
    }
    case 'map_set_layer_style': {
      const layer = vectorLayer(String(args.layerId))
      const before = layer.style
      const style = validateStyle(args.style)
      useProjectStore.getState().updateLayer(layer.id, { style })
      pushCommand({
        label: `AI: 样式 ${layer.name}`,
        undo: () => useProjectStore.getState().updateLayer(layer.id, { style: before }),
        redo: () => useProjectStore.getState().updateLayer(layer.id, { style }),
      })
      return { summary: `更新「${layer.name}」样式` }
    }
    case 'map_fit_layer': {
      engineFitToLayer(args.layerId ? String(args.layerId) : undefined)
      return { summary: '视图已缩放至图层' }
    }
    case 'map_set_view': {
      const center = args.center
      const zoom = Number(args.zoom)
      if (!Array.isArray(center) || center.length !== 2) throw new Error('center 必须是 [lon, lat]')
      if (!Number.isFinite(zoom)) throw new Error('zoom 必须是数字')
      const view = { center: [Number(center[0]), Number(center[1])] as [number, number], zoom }
      getEngine()?.setView(view, { animate: true })
      useProjectStore.getState().setView(view)
      return { summary: `视图移至 [${view.center.join(', ')}] z${zoom}` }
    }
    default:
      throw new Error(`未知编辑工具: ${tool}`)
  }
}

// ---------------------------------------------------------------------------
// 轮询循环与状态
// ---------------------------------------------------------------------------

interface AiEditState {
  enabled: boolean
  connected: boolean
  lastSummary: string | null
  lastError: string | null
  appliedCount: number
  setEnabled(enabled: boolean): void
}

export const useAiEditStore = create<AiEditState>()((set) => ({
  enabled: false,
  connected: false,
  lastSummary: null,
  lastError: null,
  appliedCount: 0,
  setEnabled(enabled) {
    set({ enabled })
    if (enabled) startPolling()
    else stopPolling()
  },
}))

let pollTimer: ReturnType<typeof setTimeout> | null = null
let ack = 0
let busy = false
let generation = 0

async function pollOnce(baseUrl: string): Promise<void> {
  const { commands, latest } = await fetchPendingEdits(ack, baseUrl)
  ack = latest // 先推进游标：即使某条校验失败也已回传错误，不重复消费
  for (const cmd of commands) {
    const outcome = applyEditCommand(cmd)
    await postEditResult(cmd.id, outcome.ok, outcome.ok ? outcome.summary : outcome.error ?? '失败')
    if (outcome.ok) {
      useAiEditStore.setState({ lastSummary: outcome.summary, lastError: null, appliedCount: useAiEditStore.getState().appliedCount + 1 })
      useUiStore.getState().flash(`AI 编辑：${outcome.summary}（可撤销）`, 'ok')
    } else {
      useAiEditStore.setState({ lastError: outcome.error ?? '失败' })
    }
  }
}

function schedule(baseUrl: string, myGeneration: number, delayMs: number): void {
  pollTimer = setTimeout(async () => {
    if (myGeneration !== generation) return
    if (busy) {
      schedule(baseUrl, myGeneration, 800)
      return
    }
    busy = true
    try {
      await pollOnce(baseUrl)
      if (!useAiEditStore.getState().connected) useAiEditStore.setState({ connected: true })
    } catch {
      if (useAiEditStore.getState().connected) useAiEditStore.setState({ connected: false })
    } finally {
      busy = false
    }
    if (myGeneration === generation) schedule(baseUrl, myGeneration, 1200)
  }, delayMs)
}

function startPolling(baseUrl = DEFAULT_BRIDGE_URL): void {
  stopPolling()
  generation += 1
  schedule(baseUrl, generation, 200)
}

function stopPolling(): void {
  generation += 1
  if (pollTimer != null) clearTimeout(pollTimer)
  pollTimer = null
  useAiEditStore.setState({ connected: false })
}
