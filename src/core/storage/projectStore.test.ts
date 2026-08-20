/**
 * projectStore 单元测试（environment: node，使用 fake-indexeddb）。
 * 注意：fake-indexeddb/auto 必须在任何 dexie 依赖模块之前导入
 * （dexie 在模块求值时捕获 globalThis.indexedDB）。
 */
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import type { RasterLayerModel, VectorLayerModel } from '@/core/layers/model'
import {
  deleteProject,
  listProjects,
  loadLatest,
  parseFromDisk,
  saveProject,
  serializeForDisk,
  type ProjectFile,
} from './projectStore'
import { db } from './idb'

const RASTER_BYTES = [0, 1, 2, 3, 127, 128, 200, 255]

function makeVectorLayer(now: number): VectorLayerModel {
  const feature: Feature = {
    type: 'Feature',
    properties: { name: '站点A', value: 1 },
    geometry: { type: 'Point', coordinates: [116.4, 39.9] },
  }
  return {
    id: 'vec_1',
    name: '矢量图层',
    kind: 'vector',
    visible: true,
    opacity: 1,
    zIndex: 0,
    createdAt: now,
    updatedAt: now,
    geometryType: 'Point',
    features: [feature],
    fields: [
      { name: 'name', type: 'string', sampleCount: 1 },
      { name: 'value', type: 'number', sampleCount: 1 },
    ],
    style: { symbol: { kind: 'simple', pointRadius: 4, pointColor: '#9e1d1c' }, label: null },
    editable: true,
    format: 'geojson',
  }
}

function makeRasterLayer(now: number): RasterLayerModel {
  return {
    id: 'ras_1',
    name: '栅格图层',
    kind: 'raster',
    visible: true,
    opacity: 0.8,
    zIndex: 1,
    createdAt: now,
    updatedAt: now,
    format: 'geotiff',
    source: {
      kind: 'geotiff',
      data: new Uint8Array(RASTER_BYTES).buffer,
      crs: 'EPSG:3857',
      width: 2,
      height: 4,
      bands: 1,
    },
  }
}

function makeSnapshot(now = Date.now()): ProjectFile {
  return {
    app: 'spatial-harness',
    version: 1,
    id: 'proj_test_1',
    name: '测试工程',
    createdAt: now,
    updatedAt: now,
    view: { center: [12959000, 4850000], zoom: 10, rotation: 0 },
    crs: 'EPSG:3857',
    layerOrder: ['vec_1', 'ras_1'],
    layers: [makeVectorLayer(now), makeRasterLayer(now)],
  }
}

describe('projectStore', () => {
  beforeEach(async () => {
    await db.projects.clear()
    await db.meta.clear()
  })

  afterEach(async () => {
    await db.projects.clear()
    await db.meta.clear()
  })

  it('saveProject 后 loadLatest 往返一致（含 raster ArrayBuffer 内容一致）', async () => {
    const snapshot = makeSnapshot()
    const result = await saveProject(snapshot)

    // node 环境无目录句柄：idb 成功、磁盘跳过
    expect(result.idb).toBe(true)
    expect(result.disk).toBe(false)
    expect(result.diskReason).toBeTruthy()

    const loaded = await loadLatest()
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe('proj_test_1')
    expect(loaded!.name).toBe('测试工程')
    expect(loaded!.view).toEqual(snapshot.view)
    expect(loaded!.crs).toBe('EPSG:3857')
    expect(loaded!.layerOrder).toEqual(['vec_1', 'ras_1'])
    expect(loaded!.layers).toHaveLength(2)

    // 矢量图层要素内联、内容一致
    const vector = loaded!.layers[0]
    expect(vector.kind).toBe('vector')
    if (vector.kind === 'vector') {
      expect(vector.features).toEqual((snapshot.layers[0] as VectorLayerModel).features)
    }

    // raster 图层 ArrayBuffer 字节一致
    const raster = loaded!.layers[1] as RasterLayerModel
    expect(raster.kind).toBe('raster')
    expect(new Uint8Array(raster.source.data)).toEqual(
      new Uint8Array((snapshot.layers[1] as RasterLayerModel).source.data),
    )
  })

  it('serializeForDisk / parseFromDisk 往返一致且 base64 正确', () => {
    const snapshot = makeSnapshot()
    const jsonText = serializeForDisk(snapshot)

    // raster data 应编码为 { __bin: <base64> }，vector 要素内联
    const raw = JSON.parse(jsonText) as {
      layers: Array<{ kind: string; source?: { data: { __bin: string } } }>
    }
    const rawRaster = raw.layers.find((l) => l.kind === 'raster')
    expect(rawRaster).toBeDefined()
    expect(typeof rawRaster!.source!.data.__bin).toBe('string')
    expect(jsonText).toContain('"features"')

    // 验证 base64 解码后与原始字节一致
    const decoded = Uint8Array.from(atob(rawRaster!.source!.data.__bin), (c) => c.charCodeAt(0))
    expect(decoded).toEqual(new Uint8Array((snapshot.layers[1] as RasterLayerModel).source.data))

    // parseFromDisk 还原 ArrayBuffer
    const restored = parseFromDisk(jsonText)
    expect(restored.app).toBe('spatial-harness')
    expect(restored.layers).toHaveLength(2)
    const restoredRaster = restored.layers[1] as RasterLayerModel
    expect(restoredRaster.source.data).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(restoredRaster.source.data)).toEqual(
      new Uint8Array((snapshot.layers[1] as RasterLayerModel).source.data),
    )
  })

  it('listProjects 按 updatedAt 返回，loadLatest 取最新，deleteProject 生效', async () => {
    const older = makeSnapshot(1000)
    const newer = makeSnapshot(2000)
    newer.id = 'proj_test_2'
    newer.name = '工程二'
    await saveProject(older)
    await saveProject(newer)

    const list = await listProjects()
    expect(list).toHaveLength(2)
    expect(list.map((p) => p.id).sort()).toEqual(['proj_test_1', 'proj_test_2'])

    const latest = await loadLatest()
    expect(latest?.id).toBe('proj_test_2')

    await deleteProject('proj_test_1')
    const after = await listProjects()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe('proj_test_2')
  })
})
