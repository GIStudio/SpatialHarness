/**
 * 引擎无关的符号化（样式）规范，类似 QGIS 的"单一符号/分类/渐变"体系。
 * 渲染细节（如 OL 的 StyleFunction）由引擎适配层负责转换。
 */
export type SymbolKind = 'simple' | 'categorized' | 'graduated'

/** 单一符号 */
export interface SimpleSymbolSpec {
  kind: 'simple'
  /** 点：半径(px) */
  pointRadius?: number
  pointSymbol?: 'circle' | 'square' | 'triangle' | 'star'
  pointColor?: string
  /** 线：颜色/宽度/虚线 */
  strokeColor?: string
  strokeWidth?: number
  strokeDash?: number[]
  /** 面：填充色 */
  fillColor?: string
}

/** 分类符号（按字段值着色，QGIS 的 Categorized） */
export interface CategorizedSymbolSpec {
  kind: 'categorized'
  field: string
  categories: { value: string; label?: string; color: string }[]
  defaultColor?: string
  strokeColor?: string
  strokeWidth?: number
}

/** 渐变符号（按数值字段分档着色，QGIS 的 Graduated） */
export interface GraduatedSymbolSpec {
  kind: 'graduated'
  field: string
  breaks: { min: number; max: number; color: string }[]
  strokeColor?: string
  strokeWidth?: number
}

export type SymbolSpec = SimpleSymbolSpec | CategorizedSymbolSpec | GraduatedSymbolSpec

/** 标注设置 */
export interface LabelSpec {
  field: string
  color?: string
  size?: number
  font?: string
  /** 是否仅选中时显示 */
  showOnSelectionOnly?: boolean
}

export interface LayerStyle {
  symbol: SymbolSpec
  label: LabelSpec | null
}

/**
 * 用于分类/渐变配色的色板（QGIS 风格）。
 * 取 Mappedinfo Palette Lab（https://mappedinfo.github.io/palette-lab/）推荐的
 * 图表序列色（朱砂→靛蓝→翡翠→琥珀→品红→天蓝→珊瑚→青草），
 * 前 8 色即档案「区分 8 组数据」建议序列；首色为新建图层默认色。
 */
export const DEFAULT_PALETTE = [
  '#9e1d1c', '#6583e0', '#008e6b', '#ffd15d', '#ee1969', '#64bbcf', '#e97a46', '#61ac4c',
  '#90e0d6', '#cca4e3', '#f5e6d0', '#ffe59d', '#808080',
]

/** 从值列表生成分类配色 */
export function generateCategories(
  values: Iterable<unknown>,
  palette: string[] = DEFAULT_PALETTE,
): { value: string; label: string; color: string }[] {
  const seen = new Set<string>()
  const out: { value: string; label: string; color: string }[] = []
  let i = 0
  for (const v of values) {
    const key = v === null || v === undefined ? '(空)' : String(v)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ value: key, label: key, color: palette[i % palette.length] })
    i++
  }
  return out
}

/** 等距分档（QGIS 的 Equal Interval） */
export function equalIntervalBreaks(values: number[], count: number): { min: number; max: number; color: string }[] {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (nums.length === 0) return []
  const min = nums[0]
  const max = nums[nums.length - 1]
  if (min === max) return [{ min, max, color: DEFAULT_PALETTE[0] }]
  const step = (max - min) / count
  const breaks: { min: number; max: number; color: string }[] = []
  for (let i = 0; i < count; i++) {
    breaks.push({
      min: min + i * step,
      max: i === count - 1 ? max : min + (i + 1) * step,
      color: DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    })
  }
  return breaks
}
