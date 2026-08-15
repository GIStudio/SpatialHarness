/**
 * 工程与图层状态（zustand）。
 * layers 数组下标即 z 序（0 = 最底层）；每个图层维护独立 rev，
 * 引擎桥接层通过 rev 变化做增量同步。
 */
import { create } from 'zustand'
import type { Feature } from 'geojson'
import type { LayerModel, VectorLayerModel } from '@/core/layers/model'
import type { ViewState } from '@/core/engine/types'
import { uid } from '@/core/layers/model'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'disk' | 'idb-only' | 'error'

export interface ProjectState {
  projectId: string | null
  projectName: string
  createdAt: number
  updatedAt: number
  dirty: boolean
  view: ViewState | null
  layers: LayerModel[]
  /** 每个图层的修改版本号（引擎增量同步用） */
  layerRev: Record<string, number>
  saveStatus: SaveStatus
  lastSavedAt: number | null
  /** 是否已连接本地文件夹 */
  diskConnected: boolean
  /** 文件夹是否可写（权限 granted） */
  diskWritable: boolean
  diskPath: string | null

  newProject(name: string): void
  restoreFromSnapshot(snapshot: {
    id: string
    name: string
    createdAt: number
    updatedAt: number
    view: ViewState | null
    layers: LayerModel[]
  }): void
  addLayer(layer: LayerModel): void
  removeLayer(id: string): void
  renameLayer(id: string, name: string): void
  updateLayer(id: string, patch: Partial<LayerModel>): void
  /** 整体替换图层数据（用于编辑提交/撤销重做） */
  replaceFeatures(id: string, features: Feature[]): void
  addFeature(id: string, feature: Feature): void
  removeFeatures(id: string, featureIds: string[]): void
  moveLayer(id: string, targetIndex: number): void
  setView(view: ViewState): void
  setSaveStatus(status: SaveStatus): void
  setLastSavedAt(t: number | null): void
  setDirty(dirty: boolean): void
  setDiskState(connected: boolean, writable: boolean, path?: string | null): void
}

function bumpRev(state: ProjectState, layerId: string): Record<string, number> {
  return { ...state.layerRev, [layerId]: (state.layerRev[layerId] ?? 0) + 1 }
}

function touch(state: ProjectState, layerId: string): Partial<ProjectState> {
  return {
    layerRev: bumpRev(state, layerId),
    dirty: true,
    updatedAt: Date.now(),
  }
}

export const useProjectStore = create<ProjectState>()((set, get) => ({
  projectId: null,
  projectName: '',
  createdAt: 0,
  updatedAt: 0,
  dirty: false,
  view: null,
  layers: [],
  layerRev: {},
  saveStatus: 'idle',
  lastSavedAt: null,
  diskConnected: false,
  diskWritable: false,
  diskPath: null,

  newProject(name) {
    const now = Date.now()
    set({
      projectId: uid('proj'),
      projectName: name || '未命名工程',
      createdAt: now,
      updatedAt: now,
      dirty: true,
      view: null,
      layers: [],
      layerRev: {},
      saveStatus: 'idle',
      lastSavedAt: null,
    })
  },

  restoreFromSnapshot(snap) {
    const layerRev: Record<string, number> = {}
    for (const l of snap.layers) layerRev[l.id] = 1
    set({
      projectId: snap.id,
      projectName: snap.name,
      createdAt: snap.createdAt,
      updatedAt: snap.updatedAt,
      dirty: false,
      view: snap.view,
      layers: snap.layers,
      layerRev,
      saveStatus: 'saved',
      lastSavedAt: Date.now(),
    })
  },

  addLayer(layer) {
    const state = get()
    set({
      layers: [...state.layers, layer],
      layerRev: { ...state.layerRev, [layer.id]: 1 },
      dirty: true,
      updatedAt: Date.now(),
    })
  },

  removeLayer(id) {
    const state = get()
    const layerRev = { ...state.layerRev }
    delete layerRev[id]
    set({
      layers: state.layers.filter((l) => l.id !== id),
      layerRev,
      dirty: true,
      updatedAt: Date.now(),
    })
  },

  renameLayer(id, name) {
    const state = get()
    set({
      layers: state.layers.map((l) => (l.id === id ? { ...l, name } : l)),
      ...touch(state, id),
    })
  },

  updateLayer(id, patch) {
    const state = get()
    set({
      layers: state.layers.map((l) =>
        l.id === id ? ({ ...l, ...patch, updatedAt: Date.now() } as LayerModel) : l,
      ),
      ...touch(state, id),
    })
  },

  replaceFeatures(id, features) {
    const state = get()
    set({
      layers: state.layers.map((l) =>
        l.id === id && l.kind === 'vector'
          ? ({ ...l, features, updatedAt: Date.now() } as VectorLayerModel)
          : l,
      ),
      ...touch(state, id),
    })
  },

  addFeature(id, feature) {
    const state = get()
    const layer = state.layers.find((l) => l.id === id)
    if (!layer || layer.kind !== 'vector') return
    set({
      layers: state.layers.map((l) =>
        l.id === id && l.kind === 'vector'
          ? ({ ...l, features: [...l.features, feature], updatedAt: Date.now() } as VectorLayerModel)
          : l,
      ),
      ...touch(state, id),
    })
  },

  removeFeatures(id, featureIds) {
    const state = get()
    const layer = state.layers.find((l) => l.id === id)
    if (!layer || layer.kind !== 'vector') return
    const removeSet = new Set(featureIds)
    set({
      layers: state.layers.map((l) =>
        l.id === id && l.kind === 'vector'
          ? ({ ...l, features: l.features.filter((f) => !removeSet.has(f.id as string)), updatedAt: Date.now() } as VectorLayerModel)
          : l,
      ),
      ...touch(state, id),
    })
  },

  moveLayer(id, targetIndex) {
    const state = get()
    const from = state.layers.findIndex((l) => l.id === id)
    if (from < 0) return
    const layers = [...state.layers]
    const [item] = layers.splice(from, 1)
    const to = Math.max(0, Math.min(targetIndex, layers.length))
    layers.splice(to, 0, item)
    set({ layers, dirty: true, updatedAt: Date.now() })
  },

  setView(view) {
    const cur = get().view
    if (
      cur &&
      cur.center[0] === view.center[0] &&
      cur.center[1] === view.center[1] &&
      cur.zoom === view.zoom
    ) {
      return
    }
    set({ view, dirty: true })
  },

  setSaveStatus(status) {
    set({ saveStatus: status })
  },
  setLastSavedAt(t) {
    set({ lastSavedAt: t })
  },
  setDirty(dirty) {
    set({ dirty })
  },
  setDiskState(connected, writable, path = null) {
    set({ diskConnected: connected, diskWritable: writable, diskPath: path })
  },
}))

/** 便捷选择器 */
export function topmostEditableVectorLayerId(layers: LayerModel[]): string | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]
    if (l.kind === 'vector' && l.editable) return l.id
  }
  return null
}
