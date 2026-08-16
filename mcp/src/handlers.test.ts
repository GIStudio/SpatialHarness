/**
 * MCP 工具处理器单元测试（node env，直接调用 handlers，不经过 MCP 传输）。
 */
import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { DatasetStore } from './registry'
import {
  handleBbox,
  handleBuffer,
  handleCentroid,
  handleClip,
  handleConvertFormat,
  handleDifference,
  handleDissolve,
  handleFieldStats,
  handleGetDataset,
  handleIntersect,
  handleLayerStats,
  handleListDatasets,
  handleLoadDataset,
  handleUnloadDataset,
} from './handlers'

/** 提取返回结果的文本内容（content 是联合类型，需窄化） */
function resultText(r: CallToolResult): string {
  const block = r.content.find((c) => c.type === 'text')
  return block && 'text' in block ? block.text : ''
}

const square = (minX: number, minY: number, maxX: number, maxY: number, props: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  id: `f_${minX}_${minY}`,
  properties: props,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
        [minX, minY],
      ],
    ],
  },
})

const fc = (features: Feature[]) => JSON.stringify({ type: 'FeatureCollection', features })

function loadInline(store: DatasetStore, features: Feature[], name = 'sample.geojson') {
  return handleLoadDataset(store, { name, data: fc(features) })
}

describe('load_dataset', () => {
  it('内联 GeoJSON 加载成功并注册数据集', async () => {
    const store = new DatasetStore()
    const r = await loadInline(store, [square(0, 0, 10, 10, { name: 'A' })])
    expect(r.isError).toBeUndefined()
    expect(store.size).toBe(1)
    const ds = store.list()[0]
    expect(ds.id).toBe('L1')
    expect(ds.geometryType).toBe('Polygon')
    expect(ds.fields.map((f) => f.name)).toContain('name')
  })

  it('path 与 data 同时缺失时报错', async () => {
    const store = new DatasetStore()
    const r = await handleLoadDataset(store, {})
    expect(r.isError).toBe(true)
    expect(resultText(r)).toContain('path 与 data')
  })

  it('内联 CSV（经纬度列自动识别）加载成功', async () => {
    const store = new DatasetStore()
    const csv = 'city,lon,lat\n北京,116.4,39.9\n上海,121.47,31.23\n'
    const r = await handleLoadDataset(store, { name: 'cities.csv', data: csv })
    expect(r.isError).toBeUndefined()
    const ds = store.list()[0]
    expect(ds.features.length).toBe(2)
    expect(ds.geometryType).toBe('Point')
  })

  it('本地文件路径加载（相对 cwd）', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shmcp-'))
    const file = path.join(dir, 'roads.geojson')
    await fs.writeFile(file, fc([square(0, 0, 5, 5, { road: 'r1' })]), 'utf8')
    try {
      const store = new DatasetStore()
      const r = await handleLoadDataset(store, { path: file })
      expect(r.isError).toBeUndefined()
      expect(store.list()[0].name).toBe('roads')
      expect(store.list()[0].features.length).toBe(1)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('不存在的路径返回可操作错误', async () => {
    const store = new DatasetStore()
    const r = await handleLoadDataset(store, { path: '/no/such/file.geojson' })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toContain('读取文件失败')
  })

  it('内联 KML 加载成功', async () => {
    const store = new DatasetStore()
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>P1</name><Point><coordinates>116.4,39.9,0</coordinates></Point></Placemark>
</Document></kml>`
    const r = await handleLoadDataset(store, { name: 'pts.kml', data: kml })
    expect(r.isError).toBeUndefined()
    expect(store.list()[0].features.length).toBe(1)
  })

  it('非法 GeoJSON 返回错误而非崩溃', async () => {
    const store = new DatasetStore()
    const r = await handleLoadDataset(store, { name: 'bad.geojson', data: '{not json' })
    expect(r.isError).toBe(true)
  })
})

describe('数据集管理', () => {
  it('list / get / unload 往返', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10)])
    const list = handleListDatasets(store)
    expect(resultText(list)).toContain('L1')

    const get = handleGetDataset(store, { layer_id: 'L1', include_geojson: true })
    expect(get.isError).toBeUndefined()
    expect(resultText(get)).toContain('GeoJSON')

    const unload = handleUnloadDataset(store, { layer_id: 'L1' })
    expect(unload.isError).toBeUndefined()
    expect(store.size).toBe(0)

    const missing = handleGetDataset(store, { layer_id: 'L9' })
    expect(missing.isError).toBe(true)
    expect(resultText(missing)).toContain('不存在')
  })
})

describe('空间分析', () => {
  it('buffer 生成新数据集并自动注册（链式可用）', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10)])
    const r = handleBuffer(store, { layer_id: 'L1', distance: 100, unit: 'meters' })
    expect(r.isError).toBeUndefined()
    expect(store.size).toBe(2)
    const result = store.get('L2')!
    expect(result.name).toContain('缓冲区')
    expect(result.features.length).toBe(1)
  })

  it('buffer 支持内联 geojson', () => {
    const store = new DatasetStore()
    const r = handleBuffer(store, { geojson: JSON.parse(fc([square(0, 0, 1, 1)])), distance: 1, unit: 'kilometers' })
    expect(r.isError).toBeUndefined()
    expect(store.size).toBe(1)
  })

  it('intersect 两个重叠正方形得到交集', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10)], 'a.geojson')
    await loadInline(store, [square(5, 5, 15, 15)], 'b.geojson')
    const r = handleIntersect(store, { layer_a_id: 'L1', layer_b_id: 'L2', include_geojson: true })
    expect(r.isError).toBeUndefined()
    const ds = store.get('L3')!
    expect(ds.features.length).toBe(1)
    const coords = (ds.features[0].geometry as { coordinates: number[][][] }).coordinates
    expect(coords[0][0]).toEqual([5, 5])
  })

  it('difference A−B 正确', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10)], 'a.geojson')
    await loadInline(store, [square(0, 0, 5, 5)], 'b.geojson')
    const r = handleDifference(store, { layer_a_id: 'L1', layer_b_id: 'L2' })
    expect(r.isError).toBeUndefined()
    // L 形剩余区域：10×10 − 5×5 = 75（按坐标差分求面积）
    const coords = (store.get('L3')!.features[0].geometry as { coordinates: number[][][] }).coordinates
    let area = 0
    for (const ring of coords) {
      for (let i = 0; i < ring.length - 1; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
      }
    }
    expect(Math.abs(area / 2)).toBeCloseTo(75, 6)
  })

  it('clip 点图层被面裁剪', async () => {
    const store = new DatasetStore()
    await loadInline(store, [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [3, 3] },
      },
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [30, 30] },
      },
    ], 'pts.geojson')
    await loadInline(store, [square(0, 0, 10, 10)], 'clip.geojson')
    const r = handleClip(store, { layer_id: 'L1', clip_layer_id: 'L2' })
    expect(r.isError).toBeUndefined()
    const kept = store.get('L3')!.features
    expect(kept.length).toBe(1)
    expect((kept[0].geometry as { coordinates: number[] }).coordinates).toEqual([3, 3])
  })

  it('dissolve 按字段融合', async () => {
    const store = new DatasetStore()
    await loadInline(store, [
      square(0, 0, 2, 2, { group: 'a' }),
      square(1, 0, 3, 2, { group: 'a' }),
      square(10, 10, 12, 12, { group: 'b' }),
    ])
    const r = handleDissolve(store, { layer_id: 'L1', field: 'group' })
    expect(r.isError).toBeUndefined()
    expect(store.get('L2')!.features.length).toBe(2)
  })

  it('centroid 保留属性', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10, { name: 'A' })])
    const r = handleCentroid(store, { layer_id: 'L1' })
    expect(r.isError).toBeUndefined()
    const c = store.get('L2')!.features[0]
    expect(c.properties?.['name']).toBe('A')
    expect((c.geometry as { coordinates: number[] }).coordinates).toEqual([5, 5])
  })

  it('bbox 生成外接矩形', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(2, 3, 8, 9)])
    const r = handleBbox(store, { layer_id: 'L1' })
    expect(r.isError).toBeUndefined()
    const rect = store.get('L2')!.features[0]
    expect((rect.geometry as { coordinates: number[][][] }).coordinates[0][0]).toEqual([2, 3])
  })

  it('field_stats 统计数值字段', async () => {
    const store = new DatasetStore()
    await loadInline(store, [
      square(0, 0, 1, 1, { pop: 100 }),
      square(1, 0, 2, 1, { pop: 300 }),
      square(2, 0, 3, 1, { pop: null }),
    ])
    const r = handleFieldStats(store, { layer_id: 'L1', field: 'pop' })
    expect(r.isError).toBeUndefined()
    const rows = r.structuredContent!.rows as (string | number)[][]
    expect(rows.find((row) => row[0] === '计数')![1]).toBe(2)
    expect(rows.find((row) => row[0] === '求和')![1]).toBe(400)
    expect(rows.find((row) => row[0] === '平均')![1]).toBe(200)
  })

  it('layer_stats 汇总', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10)])
    const r = handleLayerStats(store, { layer_id: 'L1' })
    expect(r.isError).toBeUndefined()
    const rows = r.structuredContent!.rows as (string | number)[][]
    expect(rows.find((row) => row[0] === '要素数')![1]).toBe(1)
    // turf area 为球面真实面积：赤道附近 10°×10° ≈ 1.23e12 m²
    expect(rows.find((row) => row[0] === '总面积 (m²)')![1]).toBeGreaterThan(1e12)
  })

  it('不存在的 layer_id 给出可操作提示', async () => {
    const store = new DatasetStore()
    const r = handleBuffer(store, { layer_id: 'L9', distance: 1 })
    expect(r.isError).toBe(true)
    expect(resultText(r)).toContain('load_dataset')
  })
})

describe('convert_format', () => {
  it('GeoJSON → KML', async () => {
    const store = new DatasetStore()
    await loadInline(store, [square(0, 0, 10, 10, { name: 'A' })])
    const r = await handleConvertFormat(store, { layer_id: 'L1', format: 'kml' })
    expect(r.isError).toBeUndefined()
    expect(resultText(r)).toContain('<kml xmlns')
    expect(r.structuredContent!.file_name).toBe('sample.kml')
  })

  it('点图层 GeoJSON → CSV 带 lon/lat 列', async () => {
    const store = new DatasetStore()
    await loadInline(store, [
      { type: 'Feature', properties: { city: '北京' }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } },
    ], 'cities.geojson')
    const r = await handleConvertFormat(store, { layer_id: 'L1', format: 'csv' })
    expect(r.isError).toBeUndefined()
    expect(resultText(r)).toContain('lon,lat')
    expect(resultText(r)).toContain('116.4,39.9')
  })

  it('内联 geojson 也可转换', async () => {
    const store = new DatasetStore()
    const r = await handleConvertFormat(store, {
      geojson: JSON.parse(fc([square(0, 0, 1, 1)])),
      format: 'geojson',
      layer_name: 'inline-layer',
    })
    expect(r.isError).toBeUndefined()
    expect(r.structuredContent!.file_name).toBe('inline-layer.geojson')
  })
})
