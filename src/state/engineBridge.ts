/**
 * 引擎桥接层：状态管理层（zustand）⇄ 地图引擎（MapEngine）的双向同步。
 * - 图层增删/数据/样式/顺序变化 → 增量同步到引擎
 * - 引擎事件（点击/绘制/编辑/视图）→ 写入状态管理层
 * 组件层不直接接触引擎，只操作 store。
 */
import type { Feature } from 'geojson'
import { create } from 'zustand'
import type { MapEngine, EngineFeature } from '@/core/engine/types'
import { useProjectStore, topmostEditableVectorLayerId } from './project'
import { useSelectionStore } from './selection'
import { useUiStore, isDrawTool, type Tool } from './ui'
import { useHistoryStore, featuresCommand } from './history'
import { uid } from '@/core/layers/model'

/** 鼠标位置（状态栏显示） */
export const useCursorStore = create<{ lon: number; lat: number; set(lon: number, lat: number): void }>()(
  (set, get) => ({
    lon: NaN,
    lat: NaN,
    set(lon, lat) {
      const cur = get()
      if (cur.lon === lon && cur.lat === lat) return
      set({ lon, lat })
    },
  }),
)

let engine: MapEngine | null = null
let unsubs: (() => void)[] = []
/** layerId → 已同步的 rev */
const syncedRev = new Map<string, number>()
/** 进入顶点编辑时捕获的快照 */
let modifyBefore: Feature[] | null = null

function isEditableVector(id: string): boolean {
  const layer = useProjectStore.getState().layers.find((l) => l.id === id)
  return !!layer && layer.kind === 'vector' && layer.editable
}

function drawTarget(): string | null {
  const s = useProjectStore.getState()
  const sel = useSelectionStore.getState()
  if (sel.activeLayerId && isEditableVector(sel.activeLayerId)) return sel.activeLayerId
  return topmostEditableVectorLayerId(s.layers)
}

// ---------------- store → engine ----------------

function addLayerToEngine(layerId: string) {
  const layer = useProjectStore.getState().layers.find((l) => l.id === layerId)
  if (!layer || !engine) return
  if (layer.kind === 'vector') {
    engine.addVectorLayer({
      id: layer.id,
      name: layer.name,
      features: layer.features,
      style: layer.style,
      visible: layer.visible,
      opacity: layer.opacity,
      interactive: true,
      editable: layer.editable,
    })
  } else {
    engine.addRasterLayer({
      id: layer.id,
      name: layer.name,
      source: { kind: 'geotiff', data: layer.source.data, crs: layer.source.crs },
      visible: layer.visible,
      opacity: layer.opacity,
    })
  }
}

function syncLayersDiff() {
  if (!engine) return
  const s = useProjectStore.getState()
  const engineLayers = new Set(engine.getLayerIds())
  const storeIds = new Set(s.layers.map((l) => l.id))

  // 移除已删除的图层
  for (const id of engineLayers) {
    if (!storeIds.has(id)) {
      engine.removeLayer(id)
      syncedRev.delete(id)
    }
  }
  // 新增或数据变更的图层（整体重加，保证数据/样式/可见性全量一致）
  for (const layer of s.layers) {
    const rev = s.layerRev[layer.id] ?? 0
    if (!engineLayers.has(layer.id) || (syncedRev.get(layer.id) ?? 0) !== rev) {
      if (engineLayers.has(layer.id)) engine.removeLayer(layer.id)
      addLayerToEngine(layer.id)
      syncedRev.set(layer.id, rev)
    }
  }
  // z 序：数组下标即 zIndex
  s.layers.forEach((l, i) => engine!.setLayerZIndex(l.id, i))
  // 重加后恢复选择高亮
  const sel = useSelectionStore.getState()
  for (const layer of s.layers) {
    const ids = sel.byLayer[layer.id]
    if (ids && ids.length) engine.setSelection(layer.id, ids)
  }
  // 绘制/编辑交互可能因图层重加而失效，重建
  const tool = useUiStore.getState().tool
  if (isDrawTool(tool) || tool === 'modify') syncTool(tool)
}

function syncTool(tool: Tool) {
  if (!engine) return
  const target = drawTarget()
  if (!target) {
    engine.cancelDraw()
    engine.stopModify()
    return
  }
  if (isDrawTool(tool)) {
    engine.stopModify()
    engine.startDraw(tool === 'draw-point' ? 'Point' : tool === 'draw-line' ? 'LineString' : 'Polygon', target, () => {})
  } else if (tool === 'modify') {
    engine.cancelDraw()
    const layer = useProjectStore.getState().layers.find((l) => l.id === target)
    modifyBefore = layer && layer.kind === 'vector' ? layer.features : null
    engine.startModify(target)
  } else {
    engine.cancelDraw()
    engine.stopModify()
    modifyBefore = null
  }
}

// ---------------- engine → store ----------------

function onEngineClick(payload: { coordinate: [number, number]; features: EngineFeature[] }) {
  const tool = useUiStore.getState().tool
  if (isDrawTool(tool) || tool === 'modify') return
  const sel = useSelectionStore.getState()
  if (tool === 'identify') {
    const top = payload.features[0]
    if (top) {
      sel.set(top.layerId, [top.id])
    } else {
      sel.clear()
      engine?.clearSelection()
    }
  } else if (tool === 'pan') {
    // 浏览模式下点击清除选中（QGIS 习惯）
    if (Object.keys(sel.byLayer).length) {
      sel.clear()
      engine?.clearSelection()
    }
  }
}

function onEngineDrawEnd(payload: { layerId: string; feature: Feature }) {
  const s = useProjectStore.getState()
  const layer = s.layers.find((l) => l.id === payload.layerId)
  if (!layer || layer.kind !== 'vector') return
  const before = layer.features
  const feature = payload.feature
  if (!feature.id) feature.id = uid('f')
  useProjectStore.getState().addFeature(payload.layerId, feature)
  useHistoryStore
    .getState()
    .push(featuresCommand(payload.layerId, '绘制要素', before, [...before, feature]))
}

function onEngineModifyEnd(payload: { layerId: string }) {
  if (!engine) return
  const s = useProjectStore.getState()
  const layer = s.layers.find((l) => l.id === payload.layerId)
  if (!layer || layer.kind !== 'vector') return
  const after = engine.getLayerFeatures(payload.layerId)
  const before = modifyBefore ?? layer.features
  useProjectStore.getState().replaceFeatures(payload.layerId, after)
  useHistoryStore.getState().push(featuresCommand(payload.layerId, '编辑顶点', before, after))
}

// ---------------- 生命周期 ----------------

export function attachEngine(e: MapEngine): void {
  detachEngine()
  engine = e
  syncedRev.clear()
  unsubs.push(e.on('click', onEngineClick))
  unsubs.push(e.on('pointermove', (p) => useCursorStore.getState().set(p.coordinate[0], p.coordinate[1])))
  unsubs.push(e.on('viewchange', (v) => useProjectStore.getState().setView(v)))
  unsubs.push(e.on('drawend', onEngineDrawEnd))
  unsubs.push(e.on('modifyend', onEngineModifyEnd))

  unsubs.push(
    useProjectStore.subscribe((state, prev) => {
      if (state.layers !== prev.layers || state.layerRev !== prev.layerRev) syncLayersDiff()
    }),
  )
  unsubs.push(
    useSelectionStore.subscribe((state, prev) => {
      if (state.byLayer !== prev.byLayer) {
        for (const [lid, ids] of Object.entries(state.byLayer)) {
          engine?.setSelection(lid, ids)
        }
        for (const lid of Object.keys(prev.byLayer)) {
          if (!state.byLayer[lid]) engine?.clearSelection()
        }
      }
      if (state.activeLayerId !== prev.activeLayerId) {
        syncTool(useUiStore.getState().tool)
      }
    }),
  )
  unsubs.push(
    useUiStore.subscribe((state, prev) => {
      if (state.tool !== prev.tool) syncTool(state.tool)
    }),
  )

  // 全量初始同步
  syncAll()
}

function syncAll() {
  if (!engine) return
  const s = useProjectStore.getState()
  for (const layer of s.layers) addLayerToEngine(layer.id)
  s.layers.forEach((l, i) => engine!.setLayerZIndex(l.id, i))
  const sel = useSelectionStore.getState()
  for (const [lid, ids] of Object.entries(sel.byLayer)) {
    if (ids.length) engine.setSelection(lid, ids)
  }
  if (s.view) {
    engine.setView(s.view)
  } else {
    engine.fitExtent()
  }
  for (const l of s.layers) syncedRev.set(l.id, s.layerRev[l.id] ?? 0)
  syncTool(useUiStore.getState().tool)
}

export function detachEngine(): void {
  for (const u of unsubs) u()
  unsubs = []
  engine = null
}

export function getEngine(): MapEngine | null {
  return engine
}

/** 组件主动触发的引擎操作（缩放至图层等） */
export function engineFitToLayer(layerId?: string): void {
  if (!engine) return
  engine.fitExtent(layerId ? [layerId] : undefined)
}
