/**
 * 图例自动化模块测试：色带插值 / 三种分级方法 / 图例项生成 / 自动制图。
 */
import { describe, expect, it } from 'vitest'
import type { Feature } from 'geojson'
import { COLOR_RAMPS, getRamp, lerpColor, rampColors, rampsOfType } from './ramps'
import {
  classifyValues,
  equalIntervalClassBreaks,
  jenksClassBreaks,
  quantileClassBreaks,
} from './classify'
import {
  autoStyleSpec,
  buildLegendItems,
  formatNumber,
  graduatedBreaks,
  pickAutoField,
} from './legend'
import type { GraduatedSymbolSpec, SimpleSymbolSpec } from './types'

// ---------------- ramps ----------------

describe('rampColors', () => {
  it('顺序色带按档数采样且首尾为色带端点', () => {
    const colors = rampColors('blues', 5)
    expect(colors).toHaveLength(5)
    expect(colors[0]).toBe(getRamp('blues').colors[0])
    expect(colors[4]).toBe(getRamp('blues').colors[8])
  })

  it('反转后首尾互换', () => {
    const normal = rampColors('reds', 6)
    const inverted = rampColors('reds', 6, true)
    expect(inverted[0]).toBe(normal[5])
    expect(inverted[5]).toBe(normal[0])
  })

  it('定性色带超出长度时循环取色', () => {
    const colors = rampColors('okabe-ito', 10)
    expect(colors).toHaveLength(10)
    expect(colors[8]).toBe(colors[0])
  })

  it('单档：顺序型取最深色', () => {
    expect(rampColors('blues', 1)[0]).toBe(getRamp('blues').colors.at(-1))
  })

  it('未知 id 回退到第一条色带', () => {
    expect(rampColors('nope', 3)[0]).toBe(getRamp(COLOR_RAMPS[0].id).colors[0])
  })
})

describe('lerpColor', () => {
  it('端点与中点', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000')
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('rampsOfType', () => {
  it('按类型过滤', () => {
    expect(rampsOfType('sequential').every((r) => r.type === 'sequential')).toBe(true)
    expect(rampsOfType('qualitative').length).toBeGreaterThan(0)
    expect(rampsOfType('diverging').length).toBeGreaterThan(0)
  })
})

// ---------------- classify ----------------

describe('equalIntervalClassBreaks', () => {
  it('值域均分', () => {
    const breaks = equalIntervalClassBreaks([0, 25, 50, 75, 100], 4)
    expect(breaks).toHaveLength(4)
    expect(breaks[0]).toEqual({ min: 0, max: 25 })
    expect(breaks[3]).toEqual({ min: 75, max: 100 })
  })

  it('常量数据返回单档', () => {
    expect(equalIntervalClassBreaks([5, 5, 5], 4)).toEqual([{ min: 5, max: 5 }])
  })

  it('忽略非有限值', () => {
    expect(equalIntervalClassBreaks([0, NaN, 100, Infinity], 2)).toEqual([
      { min: 0, max: 50 },
      { min: 50, max: 100 },
    ])
  })
})

describe('quantileClassBreaks', () => {
  it('每档样本量均衡', () => {
    const values = Array.from({ length: 100 }, (_, i) => i)
    const breaks = quantileClassBreaks(values, 4)
    expect(breaks).toHaveLength(4)
    expect(breaks[0].min).toBe(0)
    expect(breaks[3].max).toBe(99)
    // 分位点约在 25/50/75
    expect(breaks[1].min).toBe(25)
    expect(breaks[2].min).toBe(50)
  })

  it('大量重复值时去除重复边界', () => {
    const breaks = quantileClassBreaks([1, 1, 1, 1, 2, 9], 4)
    expect(breaks.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < breaks.length; i++) {
      expect(breaks[i].min).toBeGreaterThanOrEqual(breaks[i - 1].max)
    }
  })
})

describe('jenksClassBreaks', () => {
  it('在明显聚类处断开', () => {
    const breaks = jenksClassBreaks([1, 2, 3, 4, 100, 101, 102], 2)
    expect(breaks).toEqual([
      { min: 1, max: 4 },
      { min: 100, max: 102 },
    ])
  })

  it('三档自然分割', () => {
    const values = [1, 2, 3, 50, 51, 52, 900, 901, 902]
    const breaks = jenksClassBreaks(values, 3)
    expect(breaks).toHaveLength(3)
    expect(breaks[0]).toEqual({ min: 1, max: 3 })
    expect(breaks[1]).toEqual({ min: 50, max: 52 })
    expect(breaks[2]).toEqual({ min: 900, max: 902 })
  })

  it('档数超过样本数时不报错', () => {
    const breaks = jenksClassBreaks([1, 2], 5)
    expect(breaks.length).toBeLessThanOrEqual(2)
  })

  it('classifyValues 分发', () => {
    const values = [1, 2, 3, 100, 101]
    expect(classifyValues(values, 2, 'jenks')[0].max).toBe(3)
    expect(classifyValues(values, 2, 'equal')).toHaveLength(2)
    expect(classifyValues(values, 2, 'quantile')).toHaveLength(2)
  })
})

// ---------------- legend ----------------

describe('buildLegendItems', () => {
  it('单一符号产出单项', () => {
    const symbol: SimpleSymbolSpec = { kind: 'simple', pointRadius: 6, pointColor: '#ff0000' }
    const items = buildLegendItems(symbol, 'Point')
    expect(items).toEqual([{ label: '', color: '#ff0000', kind: 'point' }])
  })

  it('渐变符号产出带区间标签的项', () => {
    const symbol: GraduatedSymbolSpec = {
      kind: 'graduated',
      field: 'pop',
      breaks: [
        { min: 0, max: 10000, color: '#aaa' },
        { min: 10000, max: 200000000, color: '#bbb' },
      ],
    }
    const items = buildLegendItems(symbol, 'Polygon')
    expect(items).toHaveLength(2)
    expect(items[0].label).toBe('0 – 1万')
    expect(items[1].kind).toBe('polygon')
  })
})

describe('formatNumber', () => {
  it('中文大数字缩写', () => {
    expect(formatNumber(1397715000)).toBe('13.98亿')
    expect(formatNumber(12000)).toBe('1.2万')
    expect(formatNumber(3.14159)).toBe('3.14')
    expect(formatNumber(NaN)).toBe('—')
  })
})

// ---------------- autoStyle ----------------

function pts(propsList: Record<string, unknown>[]): Feature[] {
  return propsList.map((p, i) => ({
    type: 'Feature',
    properties: p,
    geometry: { type: 'Point', coordinates: [i, i] },
  }))
}

describe('autoStyleSpec', () => {
  const features = pts([
    { city: 'A', pop: 100 },
    { city: 'B', pop: 5000 },
    { city: 'C', pop: 300 },
    { city: 'D', pop: 9000000 },
    { city: 'E', pop: 8000 },
    ...Array.from({ length: 20 }, (_, i) => ({ city: `F${i}`, pop: i * 1000 })),
  ])
  const fields = [
    { name: 'city', type: 'string' },
    { name: 'pop', type: 'number' },
  ]

  it('高基数字段 → 渐变符号', () => {
    const style = autoStyleSpec(features, fields, { field: 'pop', geometryType: 'Point' })
    expect(style.symbol.kind).toBe('graduated')
    const spec = style.symbol as GraduatedSymbolSpec
    expect(spec.breaks.length).toBe(5)
    expect(spec.field).toBe('pop')
  })

  it('低基数字段 → 分类符号', () => {
    const style = autoStyleSpec(features, fields, { field: 'city', geometryType: 'Point' })
    expect(style.symbol.kind).toBe('categorized')
  })

  it('自动挑字段：优先数值', () => {
    expect(pickAutoField(features, fields)).toBe('pop')
  })

  it('graduatedBreaks 组合分级与色带', () => {
    const breaks = graduatedBreaks([1, 2, 3, 100, 200], 3, 'equal', 'viridis')
    expect(breaks).toHaveLength(3)
    expect(breaks[0].color).toBe(getRamp('viridis').colors[0])
  })
})
