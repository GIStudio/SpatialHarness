import { beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { applyEditCommand, useAiEditStore, validateFeatures, validateStyle } from './aiEdit'
import { useProjectStore } from './project'
import { useHistoryStore } from './history'
import type { VectorLayerModel } from '@/core/layers/model'

function point(id: string, lon = 116, lat = 39): Feature {
  return { type: 'Feature', id, properties: { name: id }, geometry: { type: 'Point', coordinates: [lon, lat] } }
}

function addLayerWith(features: Feature[], name = '测试层'): VectorLayerModel {
  const now = Date.now()
  const model: VectorLayerModel = {
    id: `lyr_${name}`,
    name,
    kind: 'vector',
    geometryType: 'Point',
    features,
    fields: [{ name: 'name', type: 'string' }],
    style: { symbol: { kind: 'simple', pointSymbol: 'circle', pointRadius: 5, pointColor: '#000' }, label: null },
    sourceCrs: 'EPSG:4326',
    visible: true,
    opacity: 1,
    zIndex: 0,
    createdAt: now,
    updatedAt: now,
    editable: true,
  }
  useProjectStore.getState().addLayer(model)
  return model
}

const layers = () => useProjectStore.getState().layers.filter((l) => l.kind === 'vector') as VectorLayerModel[]

beforeEach(() => {
  useProjectStore.getState().newProject('AI 编辑测试')
  useHistoryStore.getState().clear()
  useAiEditStore.setState({ lastSummary: null, lastError: null, appliedCount: 0 })
})

describe('applyEditCommand · 查询工具', () => {
  it('map_status 返回工程概要', () => {
    const out = applyEditCommand({ id: 1, tool: 'map_status', args: {} })
    expect(out.ok).toBe(true)
    expect(out.summary).toContain('AI 编辑测试')
  })

  it('map_get_project 列出图层与要素数', () => {
    addLayerWith([point('a')])
    const out = applyEditCommand({ id: 2, tool: 'map_get_project', args: {} })
    expect(out.ok).toBe(true)
    expect(out.summary).toContain('测试层')
    expect(out.summary).toContain('1 要素')
  })
})

describe('applyEditCommand · 要素编辑（全部可撤销）', () => {
  it('map_add_features 新建图层并入 history 栈', () => {
    const out = applyEditCommand({ id: 1, tool: 'map_add_features', args: { layerName: 'AI 图层', features: [point('x'), point('y')] } })
    expect(out.ok).toBe(true)
    expect(out.summary).toContain('2 个要素')
    expect(layers()).toHaveLength(1)
    expect(useHistoryStore.getState().canUndo).toBe(true)
    useHistoryStore.getState().undo()
    expect(layers()).toHaveLength(0)
  })

  it('map_add_features 追加到已有图层并可撤销', () => {
    const layer = addLayerWith([point('a')])
    const out = applyEditCommand({ id: 1, tool: 'map_add_features', args: { layerId: layer.id, features: [point('b')] } })
    expect(out.ok).toBe(true)
    expect(layers()[0].features).toHaveLength(2)
    useHistoryStore.getState().undo()
    expect(layers()[0].features).toHaveLength(1)
  })

  it('map_update_features 按 id 合并属性并替换几何', () => {
    const layer = addLayerWith([point('a', 116, 39)])
    const out = applyEditCommand({
      id: 1,
      tool: 'map_update_features',
      args: { layerId: layer.id, features: [{ type: 'Feature', id: 'a', properties: { name: '新名', extra: 1 }, geometry: { type: 'Point', coordinates: [121, 31] } }] },
    })
    expect(out.ok).toBe(true)
    const f = layers()[0].features[0]
    expect(f.properties).toMatchObject({ name: '新名', extra: 1 })
    expect((f.geometry as { coordinates: number[] }).coordinates).toEqual([121, 31])
    useHistoryStore.getState().undo()
    expect((layers()[0].features[0].geometry as { coordinates: number[] }).coordinates).toEqual([116, 39])
  })

  it('map_delete_features 按 id 删除', () => {
    const layer = addLayerWith([point('a'), point('b')])
    const out = applyEditCommand({ id: 1, tool: 'map_delete_features', args: { layerId: layer.id, featureIds: ['a'] } })
    expect(out.ok).toBe(true)
    expect(layers()[0].features.map((f) => f.id)).toEqual(['b'])
  })

  it('map_replace_features 整体替换', () => {
    const layer = addLayerWith([point('a')])
    const out = applyEditCommand({ id: 1, tool: 'map_replace_features', args: { layerId: layer.id, features: [point('n1'), point('n2'), point('n3')] } })
    expect(out.ok).toBe(true)
    expect(layers()[0].features).toHaveLength(3)
  })
})

describe('applyEditCommand · 图层与样式', () => {
  it('map_add_layer / map_remove_layer 均可撤销恢复', () => {
    applyEditCommand({ id: 1, tool: 'map_add_layer', args: { name: '新层', features: [point('p')] } })
    expect(layers()).toHaveLength(1)
    const id = layers()[0].id
    applyEditCommand({ id: 2, tool: 'map_remove_layer', args: { layerId: id } })
    expect(layers()).toHaveLength(0)
    useHistoryStore.getState().undo() // 撤销删除
    expect(layers()).toHaveLength(1)
    useHistoryStore.getState().undo() // 撤销新建
    expect(layers()).toHaveLength(0)
  })

  it('map_set_layer_style 应用并校验白名单', () => {
    const layer = addLayerWith([point('a')])
    const ok = applyEditCommand({ id: 1, tool: 'map_set_layer_style', args: { layerId: layer.id, style: { symbol: { kind: 'simple', fillColor: '#ff0000' }, label: null } } })
    expect(ok.ok).toBe(true)
    expect((layers()[0].style.symbol as { fillColor?: string }).fillColor).toBe('#ff0000')
    const bad = applyEditCommand({ id: 2, tool: 'map_set_layer_style', args: { layerId: layer.id, style: { symbol: { kind: 'categorized' }, label: null } } })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain("仅支持 'simple'")
  })
})

describe('applyEditCommand · 校验拦截', () => {
  it('畸形 Feature 被拒绝', () => {
    const out = applyEditCommand({ id: 1, tool: 'map_add_features', args: { layerName: 'x', features: [{ type: 'FeatureCollection' }] } })
    expect(out.ok).toBe(false)
    expect(out.error).toContain("缺少 type:'Feature'")
  })

  it('坐标越界（非 4326）被拒绝', () => {
    const out = applyEditCommand({
      id: 1,
      tool: 'map_add_features',
      args: { layerName: 'x', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [99999, 31] } }] },
    })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('坐标越界')
  })

  it('未知工具被拒绝', () => {
    expect(applyEditCommand({ id: 1, tool: 'map_nope', args: {} }).ok).toBe(false)
  })

  it('validateFeatures / validateStyle 直接可用', () => {
    expect(validateFeatures([point('a')])).toHaveLength(1)
    expect(() => validateStyle({ symbol: { kind: 'simple', evil: 1 }, label: null })).toThrow('未知字段')
  })
})
