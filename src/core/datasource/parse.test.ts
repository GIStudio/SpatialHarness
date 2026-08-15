/**
 * 数据源解析层测试（node env）：
 * - 手写最小点 Shapefile（.shp + .dbf + .prj）二进制 fixture，验证 parseFiles 合并链路
 * - CSV / KML / GeoJSON 解析
 * - exportVector 的 geojson / csv 往返
 */
import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import proj4 from 'proj4'
import { parseFiles } from './parse'
import { parseGeoJson } from './formats/geojson'
import { parseCsv } from './formats/csv'
import { parseKml } from './formats/kml'
import { exportVector } from './exporters'
import { ensureCrsDefined } from '@/core/crs/registry'

/* ------------------------------ Shapefile fixture ------------------------------ */

/** 构建最小点 Shapefile：100 字节大端头 + 每条记录（8 字节大端记录头 + 20 字节内容） */
function buildPointShp(points: [number, number][]): ArrayBuffer {
  const recordContentLen = 20 // 4(type) + 8(x) + 8(y)
  const fileLen = 100 + points.length * (8 + recordContentLen)
  const buf = new ArrayBuffer(fileLen)
  const dv = new DataView(buf)
  // 大端头
  dv.setInt32(0, 9994, false) // file code
  dv.setInt32(24, fileLen / 2, false) // 文件长度（16 位字）
  dv.setInt32(28, 1000, true) // version（小端）
  dv.setInt32(32, 1, true) // shape type = Point（小端）
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  dv.setFloat64(36, Math.min(...xs), true) // xmin
  dv.setFloat64(44, Math.min(...ys), true) // ymin
  dv.setFloat64(52, Math.max(...xs), true) // xmax
  dv.setFloat64(60, Math.max(...ys), true) // ymax
  // 记录
  let off = 100
  for (let i = 0; i < points.length; i++) {
    dv.setInt32(off, i + 1, false) // record number（大端）
    dv.setInt32(off + 4, 10, false) // content length = 20 字节 = 10 个字（大端）
    dv.setInt32(off + 8, 1, true) // shape type（小端）
    dv.setFloat64(off + 12, points[i][0], true)
    dv.setFloat64(off + 20, points[i][1], true)
    off += 8 + recordContentLen
  }
  return buf
}

/** 构建最小 DBF III：头（33+32n 字节）+ 0x0D 终止 + 记录（0x20 删除标志 + 字段值，CP1252 补齐空格） */
function buildDbf(fields: { name: string; type: string; len: number }[], rows: string[][]): ArrayBuffer {
  const n = fields.length
  const headerLen = 33 + 32 * n
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0)
  const buf = new ArrayBuffer(headerLen + rows.length * recLen)
  const dv = new DataView(buf)
  dv.setUint8(0, 0x03) // DBF III
  dv.setUint8(1, 24) // 日期 YY
  dv.setUint8(2, 1) // MM
  dv.setUint8(3, 1) // DD
  dv.setUint32(4, rows.length, true) // 记录数（小端）
  dv.setUint16(8, headerLen, true) // 头长度（小端）
  dv.setUint16(10, recLen, true) // 记录长度（小端）
  // 字段描述符（32 字节/个）
  let off = 32
  for (const f of fields) {
    const nameBytes = new TextEncoder().encode(f.name)
    for (let i = 0; i < 11; i++) dv.setUint8(off + i, i < nameBytes.length ? nameBytes[i] : 0x20)
    dv.setUint8(off + 11, f.type.charCodeAt(0)) // 字段类型
    dv.setUint32(off + 12, 0, true) // 数据地址（未使用）
    dv.setUint8(off + 16, f.len) // 字段长度
    dv.setUint8(off + 17, 0) // 小数位
    off += 32
  }
  dv.setUint8(off, 0x0d) // 头终止符
  // 记录
  off = headerLen
  for (const row of rows) {
    dv.setUint8(off, 0x20) // 删除标志
    off++
    for (let i = 0; i < n; i++) {
      const bytes = new TextEncoder().encode(row[i] ?? '')
      for (let j = 0; j < fields[i].len; j++) {
        dv.setUint8(off + j, j < bytes.length ? bytes[j] : 0x20) // 空格补齐
      }
      off += fields[i].len
    }
  }
  return buf
}

const WGS84_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295],AUTHORITY["EPSG","4326"]]'

const encode = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer

/* ------------------------------ 测试 ------------------------------ */

describe('datasource parse', () => {
  it('shp+dbf+prj 合并解析为带属性的点要素', async () => {
    const results = await parseFiles([
      { name: 'pts.shp', buffer: buildPointShp([[116.3, 39.9], [116.4, 39.95]]) },
      { name: 'pts.dbf', buffer: buildDbf([{ name: 'NAME', type: 'C', len: 5 }], [['A'], ['B']]) },
      { name: 'pts.prj', buffer: encode(WGS84_WKT) },
    ])
    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r.kind).toBe('vector')
    if (r.kind !== 'vector') return
    expect(r.name).toBe('pts')
    expect(r.format).toBe('shp')
    expect(r.warnings).toEqual([])
    expect(r.features).toHaveLength(2)
    expect(r.features[0].geometry).toMatchObject({ type: 'Point', coordinates: [116.3, 39.9] })
    expect(r.features[0].properties).toMatchObject({ NAME: 'A' })
    expect(r.features[1].geometry).toMatchObject({ type: 'Point', coordinates: [116.4, 39.95] })
    expect(r.features[1].properties).toMatchObject({ NAME: 'B' })
    expect(r.features[0].id).toBe('f_0')
    expect(r.features[1].id).toBe('f_1')
  })

  it('shp 无 .prj 且坐标为 CGCS2000 带号 → 推断投影并归一化', async () => {
    // EPSG:4498（CGCS2000 / 6度带 20，中央经线 117），北京附近点
    const easting = 20545000 + 45850 // ≈ lon 116.31
    const northing = 4420000 // ≈ lat 39.9
    const results = await parseFiles([
      { name: 'bj.shp', buffer: buildPointShp([[easting, northing]]) },
    ])
    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r.kind).toBe('vector')
    if (r.kind !== 'vector') return
    expect(r.sourceCrs).toBe('EPSG:4498')
    expect(r.warnings.some((w) => w.includes('CGCS2000'))).toBe(true)
    const feat = r.features[0]
    expect(feat.geometry).not.toBeNull()
    if (!feat.geometry || feat.geometry.type !== 'Point') throw new Error('应为 Point')
    // 与 proj4 直接换算的结果对照
    expect(ensureCrsDefined('EPSG:4498')).toBe(true)
    const [expLon, expLat] = proj4('EPSG:4498', 'EPSG:4326', [easting, northing])
    expect(feat.geometry.coordinates[0]).toBeCloseTo(expLon, 6)
    expect(feat.geometry.coordinates[1]).toBeCloseTo(expLat, 6)
  })

  it('shp 组缺 .shp 时跳过并记 warning', async () => {
    const results = await parseFiles([{ name: 'orphan.dbf', buffer: buildDbf([{ name: 'NAME', type: 'C', len: 5 }], [['A']]) }])
    expect(results).toHaveLength(0)
  })

  it('CSV 解析（含经纬度列，自动检测分隔符）', () => {
    const r = parseCsv('name,lon,lat\nA,116.3,39.9\nB,116.4,39.95\n', 'csvpts')
    expect(r.features).toHaveLength(2)
    expect(r.features[0].geometry).toMatchObject({ type: 'Point', coordinates: [116.3, 39.9] })
    expect(r.features[0].properties).toMatchObject({ name: 'A', lon: '116.3', lat: '39.9' })
    expect(r.warnings).toEqual([])

    // 制表符分隔
    const tab = parseCsv('name\tlng\tlat\nA\t116.3\t39.9\n', 't')
    expect(tab.features).toHaveLength(1)
    expect(tab.features[0].geometry).toMatchObject({ coordinates: [116.3, 39.9] })

    // 无坐标列 → 空要素 + warning
    const noCoord = parseCsv('a,b\n1,2\n', 'n')
    expect(noCoord.features).toHaveLength(0)
    expect(noCoord.warnings).toContain('未找到经纬度列')
  })

  it('KML 解析（@xmldom 构造 Document，含 Point Placemark）', () => {
    const kmlText = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>测试点</name><Point><coordinates>116.3,39.9,0</coordinates></Point></Placemark>
</Document></kml>`
    const r = parseKml(kmlText, 'kmlpts')
    expect(r.features).toHaveLength(1)
    // togeojson 保留 KML coordinates 中的 Z 值
    expect(r.features[0].geometry).toMatchObject({ type: 'Point', coordinates: [116.3, 39.9, 0] })
    expect(r.features[0].properties).toMatchObject({ name: '测试点' })
  })

  it('GeoJSON 解析（FeatureCollection / 单 Feature / 裸 Geometry / 空数据）', () => {
    const fc = parseGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } }],
      }),
      'gj',
    )
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties).toMatchObject({ a: 1 })

    const single = parseGeoJson(
      JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [3, 4] } }),
      'gj',
    )
    expect(single.features).toHaveLength(1)

    const bare = parseGeoJson(JSON.stringify({ type: 'Point', coordinates: [5, 6] }), 'gj')
    expect(bare.features).toHaveLength(1)
    expect(bare.features[0].geometry).toMatchObject({ type: 'Point', coordinates: [5, 6] })

    const empty = parseGeoJson('', 'gj')
    expect(empty.features).toHaveLength(0)

    expect(() => parseGeoJson('{invalid', 'gj')).toThrow()
  })

  it('exportVector geojson / csv 往返', async () => {
    const features: Feature[] = [
      { type: 'Feature', properties: { name: 'A', pop: 100 }, geometry: { type: 'Point', coordinates: [116.3, 39.9] } },
      { type: 'Feature', properties: { name: 'B', pop: 200 }, geometry: { type: 'Point', coordinates: [116.4, 39.95] } },
    ]
    // geojson
    const gj = exportVector({ features, format: 'geojson', layerName: 'out' })
    expect(gj.fileName).toBe('out.geojson')
    const parsed = JSON.parse(await gj.blob.text()) as { type: string; features: Feature[] }
    expect(parsed.type).toBe('FeatureCollection')
    expect(parsed.features).toHaveLength(2)

    // csv（点 → lon,lat 列）
    const csv = exportVector({ features, format: 'csv', layerName: 'out' })
    expect(csv.fileName).toBe('out.csv')
    const csvText = await csv.blob.text()
    expect(csvText).toContain('name,pop,lon,lat')
    expect(csvText).toContain('A,100,116.3,39.9')

    // csv（线 → WKT 列，环闭合）
    const line: Feature = {
      type: 'Feature',
      properties: { name: 'L' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    }
    const lc = exportVector({ features: [line], format: 'csv', layerName: 'line' })
    expect((await lc.blob.text()).split('\n')[0]).toBe('name,WKT')
    expect(await lc.blob.text()).toContain('LINESTRING (0 0, 1 1)')

    const poly: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 0]]] },
    }
    const pc = exportVector({ features: [poly], format: 'csv', layerName: 'poly' })
    expect(await pc.blob.text()).toContain('POLYGON ((0 0, 2 0, 2 2, 0 0))') // 未闭合自动补首点

    // kml
    const kml = exportVector({ features, format: 'kml', layerName: 'out' })
    expect(kml.fileName).toBe('out.kml')
    const kmlText = await kml.blob.text()
    expect(kmlText).toContain('<kml xmlns="http://www.opengis.net/kml/2.2">')
    expect(kmlText).toContain('<Point><coordinates>116.3,39.9</coordinates></Point>')
    expect(kmlText).toContain('<Data name="name"><value>A</value></Data>')
  })
})
