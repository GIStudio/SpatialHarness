/**
 * UI 状态：当前工具、面板开关、右侧标签页、忙碌指示、启动状态。
 */
import { create } from 'zustand'

export type Tool = 'pan' | 'identify' | 'draw-point' | 'draw-line' | 'draw-polygon' | 'modify'

export type RightTab = 'attributes' | 'style' | 'analysis'

export const TOOL_LABELS: Record<Tool, string> = {
  pan: '浏览',
  identify: '识别',
  'draw-point': '绘制点',
  'draw-line': '绘制线',
  'draw-polygon': '绘制面',
  modify: '编辑顶点',
}

export function isDrawTool(tool: Tool): boolean {
  return tool === 'draw-point' || tool === 'draw-line' || tool === 'draw-polygon'
}

export interface UiState {
  tool: Tool
  rightTab: RightTab
  rightOpen: boolean
  leftOpen: boolean
  booted: boolean
  /** 磁盘上存在可打开的工程文件 */
  diskProjectAvailable: boolean
  /** 忙碌任务（导入/分析） */
  busy: { id: string; label: string } | null
  /** 状态栏提示 */
  statusMessage: { text: string; kind: 'info' | 'ok' | 'warn' | 'error' } | null

  setTool(tool: Tool): void
  setRightTab(tab: RightTab): void
  toggleRight(): void
  toggleLeft(): void
  setBooted(b: boolean): void
  setDiskProjectAvailable(b: boolean): void
  setBusy(busy: { id: string; label: string } | null): void
  flash(text: string, kind?: 'info' | 'ok' | 'warn' | 'error'): void
}

export const useUiStore = create<UiState>()((set) => ({
  tool: 'pan',
  rightTab: 'attributes',
  rightOpen: true,
  leftOpen: true,
  booted: false,
  diskProjectAvailable: false,
  busy: null,
  statusMessage: null,

  setTool(tool) {
    set({ tool })
  },
  setRightTab(tab) {
    set({ rightTab: tab, rightOpen: true })
  },
  toggleRight() {
    set((s) => ({ rightOpen: !s.rightOpen }))
  },
  toggleLeft() {
    set((s) => ({ leftOpen: !s.leftOpen }))
  },
  setBooted(b) {
    set({ booted: b })
  },
  setDiskProjectAvailable(b) {
    set({ diskProjectAvailable: b })
  },
  setBusy(busy) {
    set({ busy })
  },
  flash(text, kind = 'info') {
    set({ statusMessage: { text, kind } })
  },
}))
