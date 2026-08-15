/**
 * 空间分析算子单元测试（vitest, node env）。
 * 用 @turf/helpers 构造测试要素；dissolve 兜底路径通过 vi.mock 模拟 turf dissolve 抛错来验证。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Feature, LineString, Polygon } from 'geojson'
import { featureCollection, point, polygon } from '@turf/helpers'
import area from '@turf/area'
import {
  opBbox,
  opBuffer,
  opCentroid,
  opClip,
  opDifference,
  opDissolve,
  opFieldStats,
  opIntersect,
  opLayerStats,
  opUnion,
} from './ops'
import type { AnalysisOutcome, AnalysisTableResult } from './types'

/** 共享状态：置 true 时模拟 @turf/dissolve 抛错（验证手动兜底路径） */
const dissolveState = vi.hoisted(() => ({ forceFail: false }))

vi.mock('@turf/dissolve', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@turf/dissolve')>()
  return {
    ...mod,
    default: (fc: Parameters<typeof mod.default>[0], options?: Parameters<typeof mod.default>[1]) => {
      if (dissolveState.forceFail) throw new Error('simulated turf dissolve failure')
      return mod.default(fc, options)
    },
  }
})

function rect(x0: number, y0: number, x1: number, y1: number, properties: Record<string, unknown> = {}): Feature<Polygon> {
  return polygon(
    [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
    properties,
  )
}

function line(coordinates: [number, number][]): Feature<LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
}

/** 统计结果中的多边形部件数（MultiPolygon 按部件拆分计数） */
function countPolygonParts(features: Feature[]): number {
  let n = 0
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Polygon') n += 1
    else if (g.type === 'MultiPolygon') n += g.coordinates.length
  }
  return n
}

function totalArea(features: Feature[]): number {
  return area(featureCollection(features))
}

function expectVectorFeatures(outcome: AnalysisOutcome): Feature[] {
  if (!outcome.ok || outcome.kind !== 'vector') {
    throw new Error(`expected vector outcome, got ${JSON.stringify(outcome)}`)
  }
  return outcome.features
}

function expectTableResult(outcome: AnalysisOutcome): AnalysisTableResult {
  if (!outcome.ok || outcome.kind !== 'table') {
    throw new Error(`expected table outcome, got ${JSON.stringify(outcome)}`)
  }
  return outcome.table
}

function rowValue(table: AnalysisTableResult, label: string): string | number | null | undefined {
  return table.rows.find((r) => r[0] === label)?.[1]
}

describe('buffer', () => {
  it('相邻多边形缓冲后要素数不变、类型为 Polygon，且面积大于原', () => {
    const a = rect(0, 0, 1, 1)
    const b = rect(1, 0, 2, 1)
    const outcome = opBuffer(
      { op: 'buffer', layerId: 'L', distance: 1, unit: 'kilometers' },
      { L: [a, b] },
    )
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(2)
    for (const f of features) expect(f.geometry?.type).toBe('Polygon')
    expect(totalArea(features)).toBeGreaterThan(totalArea([a, b]))
  })

  it('缺失图层返回找不到图层', () => {
    const outcome = opBuffer({ op: 'buffer', layerId: 'missing', distance: 1, unit: 'kilometers' }, {})
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toBe('找不到图层')
  })

  it('空图层返回空结果而非报错', () => {
    const outcome = opBuffer({ op: 'buffer', layerId: 'L', distance: 1, unit: 'kilometers' }, { L: [] })
    expect(outcome.ok).toBe(true)
    if (outcome.ok && outcome.kind === 'vector') expect(outcome.features).toEqual([])
  })
})

describe('intersect', () => {
  it('两个相交矩形结果为 1 个多边形且面积小于两者', () => {
    const a = rect(0, 0, 2, 2)
    const b = rect(1, 1, 3, 3)
    const outcome = opIntersect({ op: 'intersect', layerA: 'A', layerB: 'B' }, { A: [a], B: [b] })
    const features = expectVectorFeatures(outcome)
    expect(countPolygonParts(features)).toBe(1)
    const interArea = totalArea(features)
    expect(interArea).toBeLessThan(totalArea([a]))
    expect(interArea).toBeLessThan(totalArea([b]))
  })

  it('非面图层返回错误', () => {
    const outcome = opIntersect(
      { op: 'intersect', layerA: 'A', layerB: 'B' },
      { A: [point([0, 0])], B: [rect(0, 0, 1, 1)] },
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toBe('相交仅支持面图层')
  })
})

describe('union', () => {
  it('两个分离矩形（margin>0）得到 2 个多边形', () => {
    const outcome = opUnion(
      { op: 'union', layerA: 'A', layerB: 'B' },
      { A: [rect(0, 0, 1, 1)], B: [rect(2, 0, 3, 1)] },
    )
    expect(countPolygonParts(expectVectorFeatures(outcome))).toBe(2)
  })

  it('两个重叠矩形得到 1 个多边形', () => {
    const outcome = opUnion(
      { op: 'union', layerA: 'A', layerB: 'B' },
      { A: [rect(0, 0, 2, 2)], B: [rect(1, 1, 3, 3)] },
    )
    expect(countPolygonParts(expectVectorFeatures(outcome))).toBe(1)
  })
})

describe('difference', () => {
  it('A 减 B（部分重叠）面积小于 A 且大于 0', () => {
    const a = rect(0, 0, 2, 2)
    const b = rect(1, 1, 3, 3)
    const outcome = opDifference({ op: 'difference', layerA: 'A', layerB: 'B' }, { A: [a], B: [b] })
    const features = expectVectorFeatures(outcome)
    const d = totalArea(features)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(totalArea([a]))
  })
})


describe('overlay 多要素语义（A×B 逐对叠加）', () => {
  // @turf/area 是测地面积（m²），断言用 turf 自算期望面积做比例比较
  const approx = (got: number, expected: number) => {
    const ratio = got / expected
    expect(ratio).toBeGreaterThan(0.999)
    expect(ratio).toBeLessThan(1.001)
  }

  it('intersect：A 有两个面、B 只与其中一个重叠 → 恰好 1 个结果', () => {
    const a1 = rect(0, 0, 1, 1) // 与 B 重叠
    const a2 = rect(3, 3, 4, 4) // 不与 B 重叠
    const b = rect(0.5, 0.5, 1.5, 1.5)
    const outcome = opIntersect({ op: 'intersect', layerA: 'A', layerB: 'B' }, { A: [a1, a2], B: [b] })
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(1)
    approx(totalArea(features), area(rect(0.5, 0.5, 1, 1)))
  })

  it('intersect：同层要素互不干扰（A 内部两个分离面不会被错误求交）', () => {
    const a1 = rect(0, 0, 1, 1)
    const a2 = rect(2, 0, 3, 1)
    const b = rect(0.5, 0, 2.5, 1) // 同时覆盖两个 A 面
    const outcome = opIntersect({ op: 'intersect', layerA: 'A', layerB: 'B' }, { A: [a1, a2], B: [b] })
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(2)
    approx(totalArea(features), area(rect(0.5, 0, 1, 1)) + area(rect(2, 0, 2.5, 1)))
  })

  it('difference：A 有两个面，只减掉与 B 重叠的那个', () => {
    const a1 = rect(0, 0, 2, 2) // 与 B 部分重叠
    const a2 = rect(5, 5, 6, 6) // 不与 B 重叠，应完整保留
    const b = rect(1, 1, 3, 3)
    const outcome = opDifference({ op: 'difference', layerA: 'A', layerB: 'B' }, { A: [a1, a2], B: [b] })
    const features = expectVectorFeatures(outcome)
    // a1 减去 B 后剩 3 个单元面积（两块），a2 完整保留 1 个单元面积
    expect(features.length).toBeGreaterThanOrEqual(2)
    approx(totalArea(features), area(rect(0, 0, 1, 2)) + area(rect(1, 0, 2, 1)) + area(rect(5, 5, 6, 6)))
  })

  it('union：多要素 A∪B 合并为整体并集', () => {
    const a1 = rect(0, 0, 2, 2)
    const a2 = rect(4, 0, 5, 1)
    const b = rect(1, 1, 3, 3)
    const outcome = opUnion({ op: 'union', layerA: 'A', layerB: 'B' }, { A: [a1, a2], B: [b] })
    const features = expectVectorFeatures(outcome)
    approx(totalArea(features), area(a1) + area(a2) + area(b) - area(rect(1, 1, 2, 2)))
  })
})

describe('clip', () => {
  it('点裁剪：保留多边形内的点及原属性', () => {
    const inside = point([1, 1], { name: 'in' })
    const outside = point([5, 5], { name: 'out' })
    const outcome = opClip(
      { op: 'clip', layerId: 'P', clipLayerId: 'C' },
      { P: [inside, outside], C: [rect(0, 0, 2, 2)] },
    )
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(1)
    expect(features[0].properties?.name).toBe('in')
  })

  it('线裁剪暂不支持', () => {
    const outcome = opClip(
      { op: 'clip', layerId: 'L', clipLayerId: 'C' },
      { L: [line([[0, 0], [1, 1]])], C: [rect(0, 0, 2, 2)] },
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toBe('裁剪线要素暂不支持')
  })

  it('面裁剪与相交一致', () => {
    const a = rect(0, 0, 2, 2)
    const b = rect(1, 1, 3, 3)
    const outcome = opClip({ op: 'clip', layerId: 'A', clipLayerId: 'B' }, { A: [a], B: [b] })
    const features = expectVectorFeatures(outcome)
    expect(countPolygonParts(features)).toBe(1)
    expect(totalArea(features)).toBeLessThan(totalArea([a]))
  })
})

describe('dissolve', () => {
  it('相邻同组多边形（field grp）融合为 1 个要素', () => {
    const a = rect(0, 0, 1, 1, { grp: 'g' })
    const b = rect(1, 0, 2, 1, { grp: 'g' })
    const outcome = opDissolve({ op: 'dissolve', layerId: 'L', field: 'grp' }, { L: [a, b] })
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(1)
    expect(features[0].geometry?.type).toBe('Polygon')
  })

  it('无 field 时全部要素融合为 1 个要素', () => {
    const outcome = opDissolve({ op: 'dissolve', layerId: 'L' }, { L: [rect(0, 0, 1, 1), rect(1, 0, 2, 1)] })
    expect(countPolygonParts(expectVectorFeatures(outcome))).toBe(1)
  })

  it('兜底路径：turf dissolve 失败时按组 union 合并，两个分离同组面得到 2 个要素且保留组首属性', () => {
    dissolveState.forceFail = true
    try {
      const a = rect(0, 0, 1, 1, { grp: 'g' })
      const b = rect(3, 0, 4, 1, { grp: 'g' })
      const outcome = opDissolve({ op: 'dissolve', layerId: 'L', field: 'grp' }, { L: [a, b] })
      const features = expectVectorFeatures(outcome)
      expect(features.length).toBe(2)
      for (const f of features) expect(f.geometry?.type).toBe('Polygon')
      expect(features[0].properties?.grp).toBe('g')
      expect(features[1].properties?.grp).toBe('g')

      // 兜底对相邻同组面仍能正确合并为 1 个要素
      const merged = opDissolve(
        { op: 'dissolve', layerId: 'L', field: 'grp' },
        { L: [rect(0, 0, 1, 1, { grp: 'g' }), rect(1, 0, 2, 1, { grp: 'g' })] },
      )
      expect(countPolygonParts(expectVectorFeatures(merged))).toBe(1)
    } finally {
      dissolveState.forceFail = false
    }
  })
})

describe('centroid', () => {
  it('矩形质心约等于矩形中心且保留原属性', () => {
    const outcome = opCentroid(
      { op: 'centroid', layerId: 'L' },
      { L: [rect(0, 0, 2, 2, { name: 'sq' })] },
    )
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(1)
    const g = features[0].geometry
    expect(g?.type).toBe('Point')
    if (g?.type === 'Point') {
      expect(g.coordinates[0]).toBeCloseTo(1, 6)
      expect(g.coordinates[1]).toBeCloseTo(1, 6)
    }
    expect(features[0].properties?.name).toBe('sq')
  })
})

describe('fieldStats', () => {
  it('数值字段统计正确（mean/min/max 等）', () => {
    const feats = [1, 2, 3, 4].map((v) => rect(0, 0, 1, 1, { val: v }))
    feats.push(rect(0, 0, 1, 1, { val: null }))
    const outcome = opFieldStats({ op: 'fieldStats', layerId: 'L', field: 'val' }, { L: feats })
    const table = expectTableResult(outcome)
    expect(table.columns).toEqual(['统计项', '值'])
    expect(rowValue(table, '计数')).toBe(4)
    expect(rowValue(table, '空值')).toBe(1)
    expect(rowValue(table, '求和')).toBe(10)
    expect(rowValue(table, '平均')).toBe(2.5)
    expect(rowValue(table, '最小')).toBe(1)
    expect(rowValue(table, '最大')).toBe(4)
    const std = rowValue(table, '标准差') as number
    expect(std).toBeCloseTo(Math.sqrt(5 / 3), 6)
  })

  it('字段全非数值返回错误', () => {
    const outcome = opFieldStats(
      { op: 'fieldStats', layerId: 'L', field: 'name' },
      { L: [rect(0, 0, 1, 1, { name: 'a' })] },
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.error).toBe('字段不含数值')
  })
})

describe('layerStats', () => {
  it('要素数 / 点线面混合数 / 总面积 / 总长度 / 外包矩形', () => {
    const polys = [rect(0, 0, 1, 1), rect(2, 0, 3, 1)]
    const ln = line([[0, 0], [1, 1]])
    const outcome = opLayerStats({ op: 'layerStats', layerId: 'L' }, { L: [...polys, ln] })
    const table = expectTableResult(outcome)
    expect(rowValue(table, '要素数')).toBe(3)
    expect(rowValue(table, '点')).toBe(0)
    expect(rowValue(table, '线')).toBe(1)
    expect(rowValue(table, '面')).toBe(2)
    expect(rowValue(table, '混合')).toBe(0)
    expect(Number(rowValue(table, '总面积 (m²)'))).toBeGreaterThan(0)
    expect(Number(rowValue(table, '总长度 (km)'))).toBeGreaterThan(0)
    const extent = rowValue(table, '外包矩形') as string
    expect(extent).toMatch(/^-?\d+\.\d{6}, -?\d+\.\d{6}, -?\d+\.\d{6}, -?\d+\.\d{6}$/)
  })
})

describe('bbox', () => {
  it('生成外接矩形要素，宽高为经纬度差', () => {
    const outcome = opBbox({ op: 'bbox', layerId: 'L' }, { L: [rect(0, 0, 1, 1), rect(2, 0, 3, 1)] })
    const features = expectVectorFeatures(outcome)
    expect(features.length).toBe(1)
    expect(features[0].geometry?.type).toBe('Polygon')
    expect(features[0].properties?.sourceLayer).toBe('L')
    expect(features[0].properties?.width).toBeCloseTo(3, 6)
    expect(features[0].properties?.height).toBeCloseTo(1, 6)
  })
})
