/**
 * 引擎注册表：框架通过它创建/切换引擎实例。
 * v1 默认注册 OpenLayers；未来新增引擎（MapLibre GL 等）只需实现 MapEngine
 * 并在此 register，UI 层零改动。
 */
import type { EngineFactory, EngineRegistry, MapEngine } from './types'
import { OlEngine } from './ol/OlEngine'

const factories = new Map<string, { displayName: string; factory: EngineFactory }>()
let defaultId: string | null = null

export const engineRegistry: EngineRegistry = {
  register(id, displayName, factory) {
    factories.set(id, { displayName, factory })
    if (!defaultId) defaultId = id
  },
  create(id) {
    const target = id ?? defaultId
    if (!target) return null
    const entry = factories.get(target)
    return entry ? entry.factory() : null
  },
  available() {
    return [...factories.entries()].map(([id, v]) => ({ id, displayName: v.displayName }))
  },
}

// 默认注册 OpenLayers 引擎
engineRegistry.register('ol', 'OpenLayers', () => new OlEngine())

/** 创建默认引擎实例（MapView 使用） */
export function createDefaultEngine(): MapEngine {
  const engine = engineRegistry.create()
  if (!engine) throw new Error('没有注册任何地图引擎')
  return engine
}
