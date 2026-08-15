/**
 * 撤销/重做：命令模式。命令直接操作 project store（replaceFeatures 等），
 * 引擎桥接层会自动同步。
 */
import { create } from 'zustand'
import type { Feature } from 'geojson'
import { useProjectStore } from './project'

export interface Command {
  label: string
  undo(): void
  redo(): void
}

export interface HistoryState {
  undoStack: Command[]
  redoStack: Command[]
  canUndo: boolean
  canRedo: boolean
  push(cmd: Command): void
  undo(): void
  redo(): void
  clear(): void
}

/** 图层要素替换命令（最常用的编辑命令） */
export function featuresCommand(layerId: string, label: string, before: Feature[], after: Feature[]): Command {
  return {
    label,
    undo: () => useProjectStore.getState().replaceFeatures(layerId, before),
    redo: () => useProjectStore.getState().replaceFeatures(layerId, after),
  }
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,

  push(cmd) {
    set((s) => ({
      undoStack: [...s.undoStack.slice(-99), cmd],
      redoStack: [],
      canUndo: true,
      canRedo: false,
    }))
  },
  undo() {
    const s = get()
    const cmd = s.undoStack[s.undoStack.length - 1]
    if (!cmd) return
    cmd.undo()
    set({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, cmd],
      canUndo: s.undoStack.length > 1,
      canRedo: true,
    })
  },
  redo() {
    const s = get()
    const cmd = s.redoStack[s.redoStack.length - 1]
    if (!cmd) return
    cmd.redo()
    set({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, cmd],
      canUndo: true,
      canRedo: s.redoStack.length > 1,
    })
  },
  clear() {
    set({ undoStack: [], redoStack: [], canUndo: false, canRedo: false })
  },
}))
