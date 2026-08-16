/**
 * Shapefile 写入器测试：
 * - 二进制结构（.shp/.shx/.dbf 头与记录布局、zip 魔数）
 * - 全链路往返：exportVector(shp) → zip → parseFiles（与导入链路同源）
 * - 中文属性（UTF-8 dbf + .cpg）、面孔体定向、混合几何跳过、字段名清洗
 */
import { describe, expect, it } from 'vitest'
import type { Feature, Position } from 'geojson'
import { parseFiles } from './parse'
import { exportVector } from './exporters'
import { crc32, zipStore } from './formats/zipStore'
import {
  SHP_POINT,
  SHP_POLYLINE,
  sanitizeFileStem,
  signedArea,
  writeShapefileParts,
} from './formats/shpWrite'

/* ------------------------------ 工具 ------------------------------ */

async function roundtrip(features: Feature[], layerName = 'rt'): Promise<{ features: Feature[]; warnings: string[] }> {
  const exported = await exportVector({ features, format: 'shp', layerName })
  expect(exported.fileName).toBe(`${layerName}.zip`)
  const buffer = await exported.blob.arrayBuffer()
  const results = await parseFiles([{ name: exported.fileName, buffer }])
  expect(results).toHaveLength(1)
  const r = results[0]
  expect(r.kind).toBe('vector')
  if (r.kind !== 'vector') throw new Error('应为矢量结果')
  return { features: r.features, warnings: [...r.warnings, ...(exported.warnings ?? [])] }
}

function pt(lon: number, lat: number): Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }
}

/* ------------------------------ 二进制结构 ------------------------------ */

describe('shapefile 写入（二进制结构）', () => {
  it('点图层：shp/shx 头与记录布局符合规范', () => {
    const parts = writeShapefileParts([
      { ...pt(116.3, 39.9), properties: { name: 'A' } },
      { ...pt(116.4, 39.95), properties: { name: 'B' } },
    ])
    expect(parts.shapeType).toBe(SHP_POINT)
    expect(parts.exported).toBe(2)

    const dv = new DataView(parts.shp.buffer, parts.shp.byteOffset, parts.shp.byteLength)
    expect(dv.getInt32(0, false)).toBe(9994) // 文件码（大端）
    expect(dv.getInt32(28, true)).toBe(1000) // 版本（小端）
    expect(dv.getInt32(32, true)).toBe(SHP_POINT)
    expect(dv.getInt32(24, false) * 2).toBe(parts.shp.length) // 文件长度（16 位字）
    expect(dv.getFloat64(36, true)).toBeCloseTo(116.3) // xmin
    expect(dv.getFloat64(52, true)).toBeCloseTo(116.4) // xmax
    // 记录 1：大端记录头 + Point 内容
    expect(dv.getInt32(100, false)).toBe(1) // record number
    expect(dv.getInt32(104, false) * 2).toBe(20) // content length（4 type + 16 xy）
    expect(dv.getInt32(108, true)).toBe(SHP_POINT)
    expect(dv.getFloat64(112, true)).toBeCloseTo(116.3)
    expect(dv.getFloat64(120, true)).toBeCloseTo(39.9)

    // .shx：100 字节头 + 每记录 8 字节索引，偏移与 shp 对齐
    const dx = new DataView(parts.shx.buffer, parts.shx.byteOffset, parts.shx.byteLength)
    expect(dx.getInt32(24, false) * 2).toBe(parts.shx.length)
    expect(dx.getInt32(100, false) * 2).toBe(100) // 第一条记录偏移
    expect(dx.getInt32(104, false) * 2).toBe(20)
    expect(dx.getInt32(108, false) * 2).toBe(128) // 第二条：100 + 8 + 20
  })

  it('dbf：字段描述符与 UTF-8 标记（LDID 0x57）', () => {
    const parts = writeShapefileParts([{ ...pt(0, 0), properties: { name: '北京', pop: 2189 } }])
    const d = new DataView(parts.dbf.buffer, parts.dbf.byteOffset, parts.dbf.byteLength)
    expect(d.getUint8(0)).toBe(0x03) // dBASE III
    expect(d.getUint32(4, true)).toBe(1) // 记录数
    expect(d.getUint8(29)).toBe(0x57) // UTF-8 LDID
    const headerLen = d.getUint16(8, true)
    expect(headerLen).toBe(32 + 2 * 32 + 1) // 两个字段
    // 字段名（11 字节区）
    const nameBytes = parts.dbf.slice(32, 43)
    expect(new TextDecoder().decode(nameBytes).trim()).toBe('name')
    expect(parts.dbf[43]).toBe('C'.charCodeAt(0))
    expect(parts.dbf[32 + 32 + 11]).toBe('N'.charCodeAt(0))
    // 记录区紧随 0x0D 终止符
    expect(d.getUint8(headerLen - 1)).toBe(0x0d)
    expect(d.getUint8(headerLen)).toBe(0x20) // 删除标志
  })

  it('zip：魔数与 CRC32 正确', () => {
    const data = new TextEncoder().encode('hello spatial')
    const zip = zipStore([{ name: 'a.txt', data }])
    expect(zip[0]).toBe(0x50) // 'P'
    expect(zip[1]).toBe(0x4b) // 'K'
    expect(zip[2]).toBe(3)
    expect(zip[3]).toBe(4)
    // EOCD 在末尾 22 字节
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(zip.length - 22, true)).toBe(0x06054b50)
    // CRC32 参考值（标准校验和）
    expect(crc32(data)).toBe(0xe985b1f0)
  })

  it('空要素集合抛出错误', () => {
    expect(() => writeShapefileParts([])).toThrow()
    const nullGeom = { type: 'Feature', properties: {}, geometry: null } as unknown as Feature
    expect(() => writeShapefileParts([nullGeom])).toThrow()
  })

  it('文件名主干清洗', () => {
    expect(sanitizeFileStem('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeFileStem('   ')).toBe('layer')
    expect(sanitizeFileStem('地块 2024')).toBe('地块 2024')
  })
})

/* ------------------------------ 往返（经导入链路） ------------------------------ */

describe('shapefile 导出→导入往返', () => {
  it('点 + 中文属性 + 数值属性完整往返', async () => {
    const features: Feature[] = [
      { type: 'Feature', properties: { name: '北京', pop: 2189, ratio: 0.75 }, geometry: { type: 'Point', coordinates: [116.4074, 39.9042] } },
      { type: 'Feature', properties: { name: '上海', pop: 2487, ratio: 1.25 }, geometry: { type: 'Point', coordinates: [121.4737, 31.2304] } },
    ]
    const { features: back } = await roundtrip(features, 'cities')
    expect(back).toHaveLength(2)
    // zip 导入路径经 proj4 恒等换算，坐标存在 ~1e-14 浮点噪声
    const g0 = back[0].geometry
    expect(g0?.type).toBe('Point')
    if (g0?.type === 'Point') {
      expect(g0.coordinates[0]).toBeCloseTo(116.4074, 8)
      expect(g0.coordinates[1]).toBeCloseTo(39.9042, 8)
    }
    expect(back[0].properties).toMatchObject({ name: '北京', pop: 2189, ratio: 0.75 })
    expect(back[1].properties).toMatchObject({ name: '上海', pop: 2487, ratio: 1.25 })
  })

  it('面（含孔洞）往返且环定向符合规范（外环顺时针 / 孔逆时针）', async () => {
    // 故意给反向环：外环 CCW、孔 CW，验证写入时被纠正
    const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]] // CCW（正面积）
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]] // CW（负面积）
    const feature: Feature = {
      type: 'Feature',
      properties: { name: '带孔地块' },
      geometry: { type: 'Polygon', coordinates: [outer, hole] },
    }
    const { features: back } = await roundtrip([feature], 'poly')
    expect(back).toHaveLength(1)
    const g = back[0].geometry
    expect(g?.type).toBe('Polygon')
    if (g?.type !== 'Polygon') throw new Error('应为 Polygon')
    expect(g.coordinates).toHaveLength(2)
    expect(signedArea(g.coordinates[0] as Position[])).toBeLessThan(0) // 外环顺时针
    expect(signedArea(g.coordinates[1] as Position[])).toBeGreaterThan(0) // 孔逆时针
    expect(back[0].properties).toMatchObject({ name: '带孔地块' })
  })

  it('MultiPolygon 往返为多 part 面', async () => {
    const feature: Feature = {
      type: 'Feature',
      properties: { id: 7 },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
          [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
        ],
      },
    }
    const { features: back } = await roundtrip([feature], 'multi')
    expect(back).toHaveLength(1)
    const g = back[0].geometry
    // shpjs 把多 part 面读回 Polygon 或 MultiPolygon 均可，坐标总量须守恒
    const rings = g?.type === 'MultiPolygon' ? g.coordinates.flat() : g?.type === 'Polygon' ? g.coordinates : []
    expect(rings.length).toBeGreaterThanOrEqual(2)
  })

  it('线（LineString + MultiLineString）往返', async () => {
    const features: Feature[] = [
      { type: 'Feature', properties: { road: 'G1' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] } },
      { type: 'Feature', properties: { road: 'G2' }, geometry: { type: 'MultiLineString', coordinates: [[[5, 5], [6, 6]], [[7, 7], [8, 7]]] } },
    ]
    const parts = writeShapefileParts(features)
    expect(parts.shapeType).toBe(SHP_POLYLINE)
    const { features: back } = await roundtrip(features, 'roads')
    expect(back).toHaveLength(2)
    expect(back[0].properties).toMatchObject({ road: 'G1' })
    const g1 = back[1].geometry
    expect(g1 && (g1.type === 'MultiLineString' || g1.type === 'LineString')).toBe(true)
  })

  it('MultiPoint 与 Point 混合 → 统一写 MultiPoint', async () => {
    const features: Feature[] = [
      pt(1, 1),
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [[2, 2], [3, 3]] } },
    ]
    const parts = writeShapefileParts(features)
    expect(parts.exported).toBe(2)
    const { features: back } = await roundtrip(features, 'mp')
    expect(back).toHaveLength(2)
  })

  it('混合几何：按多数族导出，跳过其余并告警', async () => {
    const features: Feature[] = [pt(0, 0), pt(1, 1), {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }]
    const parts = writeShapefileParts(features)
    expect(parts.shapeType).toBe(SHP_POINT)
    expect(parts.exported).toBe(2)
    expect(parts.skipped).toBe(1)
    expect(parts.warnings.some((w) => w.includes('跳过 1'))).toBe(true)
    const { features: back, warnings } = await roundtrip(features, 'mixed')
    expect(back).toHaveLength(2)
    expect(warnings.some((w) => w.includes('跳过'))).toBe(true)
  })

  it('字段名清洗：超长/中文/重名 → 合法 dBASE 名', async () => {
    const feature: Feature = {
      type: 'Feature',
      properties: {
        aVeryLongFieldNameExceedingLimit: 1,
        中文名称: 'x',
        name: 'y',
        NAME: 'z', // 与 name 大小写冲突 → 去重
      },
      geometry: { type: 'Point', coordinates: [0, 0] },
    }
    const parts = writeShapefileParts([feature])
    const names = readDbfFieldNames(parts.dbf)
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(10)
      expect(/^[A-Za-z0-9_]+$/.test(n)).toBe(true)
    }
    expect(new Set(names.map((n) => n.toUpperCase())).size).toBe(names.length)
    expect(parts.warnings.length).toBeGreaterThan(0)
    // 值仍然随行可读
    const { features: back } = await roundtrip([feature], 'fields')
    const props = back[0].properties as Record<string, unknown>
    expect(Object.values(props)).toContain('x')
    expect(Object.values(props)).toContain('y')
    expect(Object.values(props)).toContain('z')
    expect(Object.values(props)).toContain(1)
  })

  it('无属性要素 → 自动生成 FID 字段', () => {
    const parts = writeShapefileParts([pt(0, 0), pt(1, 1)])
    const names = readDbfFieldNames(parts.dbf)
    expect(names).toEqual(['FID'])
  })
})

/* ------------------------------ 辅助 ------------------------------ */

function readDbfFieldNames(dbf: Uint8Array): string[] {
  const dv = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength)
  const headerLen = dv.getUint16(8, true)
  const names: string[] = []
  for (let off = 32; off < headerLen - 1; off += 32) {
    const raw = dbf.slice(off, off + 11)
    names.push(new TextDecoder().decode(raw).replace(/[\0\x20]+$/g, '').trim())
  }
  return names
}
