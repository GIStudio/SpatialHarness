/**
 * 要素选择状态（按图层分组的 feature id 集合）。
 */
import { create } from 'zustand'

export interface SelectionState {
  /** layerId → feature ids */
  byLayer: Record<string, string[]>
  /** 当前活动图层（编辑/绘制/属性表的目标） */
  activeLayerId: string | null

  set(layerId: string, ids: string[]): void
  toggle(layerId: string, id: string): void
  clear(): void
  clearLayer(layerId: string): void
  setActiveLayer(layerId: string | null): void
}

export const useSelectionStore = create<SelectionState>()((set, get) => ({
  byLayer: {},
  activeLayerId: null,

  set(layerId, ids) {
    set((s) => ({
      byLayer: { ...s.byLayer, [layerId]: ids },
      activeLayerId: layerId,
    }))
  },
  toggle(layerId, id) {
    const cur = get().byLayer[layerId] ?? []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    set((s) => ({
      byLayer: { ...s.byLayer, [layerId]: next },
      activeLayerId: layerId,
    }))
  },
  clear() {
    set({ byLayer: {} })
  },
  clearLayer(layerId) {
    set((s) => {
      const byLayer = { ...s.byLayer }
      delete byLayer[layerId]
      return { byLayer }
    })
  },
  setActiveLayer(layerId) {
    set({ activeLayerId: layerId })
  },
}))

export function selectionCount(s: SelectionState): number {
  return Object.values(s.byLayer).reduce((sum, ids) => sum + ids.length, 0)
}
