/**
 * GeoPackage 读写测试（node env，纯 sql.js WASM）：
 * - writeGpkg → parseGpkg 往返（中文属性 / 数值 / 点线面）
 * - 经 parseFiles / exportVector 的全链路（与导入导出同源）
 * - 表名清洗、无要素表告警
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import type { Feature } from 'geojson'
import { configureGpkg, parseGpkg, sanitizeGpkgTableName, writeGpkg } from './formats/gpkg'
import { parseFiles } from './parse'
import { exportVector } from './exporters'

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('rtree-sql.js/dist/sql-wasm.wasm')

beforeAll(() => {
  configureGpkg({ wasmBytes: new Uint8Array(readFileSync(wasmPath)) })
})

const features: Feature[] = [
  { type: 'Feature', properties: { name: '北京', pop: 2189, ratio: 0.75 }, geometry: { type: 'Point', coordinates: [116.4074, 39.9042] } },
  { type: 'Feature', properties: { name: '地块A', pop: 1200, ratio: 1.5 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
  { type: 'Feature', properties: { name: '路', pop: 0, ratio: 2.25 }, geometry: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } },
]

describe('geopackage 读写', () => {
  it('writeGpkg → parseGpkg 往返（中文/数值/点线面）', async () => {
    const bytes = await writeGpkg(features, 'demo')
    // SQLite 魔数
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('SQ')
    const layers = await parseGpkg(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'demo')
    expect(layers).toHaveLength(1)
    const r = layers[0]
    expect(r.kind).toBe('vector')
    if (r.kind !== 'vector') throw new Error('应为矢量结果')
    expect(r.name).toBe('demo')
    expect(r.format).toBe('gpkg')
    expect(r.features).toHaveLength(3)
    const byName = Object.fromEntries(r.features.map((f) => [String(f.properties?.name), f]))
    expect(byName['北京'].geometry).toMatchObject({ type: 'Point', coordinates: [116.4074, 39.9042] })
    expect(byName['北京'].properties).toMatchObject({ pop: 2189, ratio: 0.75 })
    expect(byName['地块A'].geometry?.type).toBe('Polygon')
    expect(byName['路'].geometry?.type).toBe('LineString')
    // 主键 id 不应混入用户属性
    expect(byName['北京'].properties).not.toHaveProperty('id')
  })

  it('全链路：exportVector(gpkg) → parseFiles 导入', async () => {
    const exported = await exportVector({ features, format: 'gpkg', layerName: 'cities' })
    expect(exported.fileName).toBe('cities.gpkg')
    const buffer = await exported.blob.arrayBuffer()
    const results = await parseFiles([{ name: 'cities.gpkg', buffer }])
    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r.kind).toBe('vector')
    if (r.kind !== 'vector') return
    expect(r.name).toBe('cities')
    expect(r.format).toBe('gpkg')
    expect(r.features).toHaveLength(3)
  })

  it('表名清洗', () => {
    expect(sanitizeGpkgTableName('my-layer.v2')).toBe('my_layer_v2')
    expect(sanitizeGpkgTableName('地块 2024')).toBe('地块_2024')
    expect(sanitizeGpkgTableName('***')).toBe('features')
  })

  it('空要素集合仍可写读（0 行表）', async () => {
    const bytes = await writeGpkg([], 'empty')
    const layers = await parseGpkg(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'empty')
    expect(layers).toHaveLength(1)
    const r = layers[0]
    expect(r.kind).toBe('vector')
    if (r.kind !== 'vector') throw new Error('应为矢量结果')
    expect(r.features).toHaveLength(0)
  })
})
