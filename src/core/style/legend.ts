/**
 * 图例自动生成（引擎无关）：从符号规范派生图例项，并支持
 * "自动制图"——给定字段与偏好，一键产出整套 LayerStyle。
 */
import type { Feature } from 'geojson'
import type {
  CategorizedSymbolSpec,
  GraduatedSymbolSpec,
  LayerStyle,
  SymbolSpec,
} from './types'
import type { VectorGeometryType } from '@/core/layers/model'
import { rampColors } from './ramps'
import { classifyValues, type ClassifyMethod } from './classify'
import { generateCategories } from './types'

export type LegendItemKind = 'point' | 'line' | 'polygon'

export interface LegendItem {
  label: string
  color: string
  kind: LegendItemKind
}

/** 按图层分组的图例（供地图浮层与 PNG 导出共用） */
export interface LegendGroup {
  layerName: string
  items: LegendItem[]
}

/** 从图层集合收集图例（跳过不可见图层；单项过多时截断） */
export function collectLegendGroups(
  layers: { name: string; visible: boolean; kind: string; geometryType?: VectorGeometryType; style?: LayerStyle }[],
  maxItemsPerLayer = 20,
): LegendGroup[] {
  const groups: LegendGroup[] = []
  for (const layer of layers) {
    if (!layer.visible || layer.kind !== 'vector' || !layer.style) continue
    const items = buildLegendItems(layer.style.symbol, layer.geometryType ?? 'Polygon')
    if (items.length === 0) continue
    groups.push({ layerName: layer.name, items: items.slice(0, maxItemsPerLayer) })
  }
  return groups
}

function itemKind(geometryType: VectorGeometryType): LegendItemKind {
  if (geometryType === 'Point') return 'point'
  if (geometryType === 'LineString') return 'line'
  return 'polygon'
}

/** 数值区间标签（紧凑格式化） */
export function formatBreakLabel(min: number, max: number): string {
  return `${formatNumber(min)} – ${formatNumber(max)}`
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e8) return `${Number((n / 1e8).toFixed(2))}亿`
  if (abs >= 1e4) return `${Number((n / 1e4).toFixed(2))}万`
  if (Number.isInteger(n)) return String(n)
  if (abs >= 100) return n.toFixed(1)
  return String(Number(n.toFixed(2)))
}

/** 从符号规范派生图例项（供地图图例浮层与 PNG 导出共用） */
export function buildLegendItems(symbol: SymbolSpec, geometryType: VectorGeometryType): LegendItem[] {
  const kind = itemKind(geometryType)
  if (symbol.kind === 'simple') {
    const color =
      symbol.fillColor ?? symbol.pointColor ?? symbol.strokeColor ?? '#9e1d1c'
    return [{ label: '', color, kind }]
  }
  if (symbol.kind === 'categorized') {
    return symbol.categories.map((c) => ({
      label: c.label ?? c.value,
      color: c.color,
      kind,
    }))
  }
  return symbol.breaks.map((b) => ({
    label: formatBreakLabel(b.min, b.max),
    color: b.color,
    kind,
  }))
}

/** 用指定方法与色带组装渐变符号 breaks（含颜色与边界） */
export function graduatedBreaks(
  values: number[],
  count: number,
  method: ClassifyMethod,
  rampId: string,
  invert = false,
): { min: number; max: number; color: string }[] {
  const breaks = classifyValues(values, count, method)
  const colors = rampColors(rampId, breaks.length, invert)
  return breaks.map((b, i) => ({ ...b, color: colors[i] }))
}

// ---------------- 自动制图 ----------------

export interface AutoStyleOptions {
  /** 指定字段；缺省时自动挑选信息量最大的字段 */
  field?: string
  /** 分档数（数值字段），默认 5 */
  classes?: number
  /** 分级方法，默认自然间断点 */
  method?: ClassifyMethod
  /** 数值色带 / 分类色带 */
  ramp?: string
  /** 反转色带 */
  invert?: boolean
  /** 强制符号类型；默认 'auto'（按字段类型与基数自动选择） */
  kind?: 'auto' | 'categorized' | 'graduated'
  /** 唯一值超过该数量的数值字段走渐变而非分类，默认 12 */
  maxCategories?: number
  /** 几何类型（决定线宽等细节） */
  geometryType?: VectorGeometryType
}

/** 收集字段非空值 */
export function fieldValues(features: Feature[], field: string): unknown[] {
  const out: unknown[] = []
  for (const f of features) {
    const v = f.properties?.[field]
    if (v === null || v === undefined || v === '') continue
    out.push(v)
  }
  return out
}

export function numericValues(features: Feature[], field: string): number[] {
  const out: number[] = []
  for (const f of features) {
    const v = f.properties?.[field]
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}

function uniqueCount(values: unknown[]): number {
  return new Set(values.map((v) => String(v))).size
}

/** 自动挑选最适合符号化的字段：优先数值字段，其次低基数字符串字段 */
export function pickAutoField(features: Feature[], fields: { name: string; type: string }[]): string | null {
  const candidates = fields.filter((f) => !/^(id|fid|gid|uuid)$/i.test(f.name))
  if (candidates.length === 0) return null
  let best: { name: string; score: number } | null = null
  for (const f of candidates) {
    const vals = fieldValues(features, f.name)
    if (vals.length === 0) continue
    const uniq = uniqueCount(vals)
    let score = 0
    if (f.type === 'number') score += 10
    if (uniq > 1) score += 5
    if (uniq >= 3 && uniq <= 30) score += 5
    if (uniq === 1) score -= 20
    if (!best || score > best.score) best = { name: f.name, score }
  }
  return best?.name ?? candidates[0].name
}

/**
 * 自动制图核心：给定要素与字段，自动决定分类/渐变并产出整套 LayerStyle。
 * - 数值字段且唯一值 > maxCategories → 渐变符号（顺序色带）
 * - 其余 → 分类符号（定性色带）
 */
export function autoStyleSpec(
  features: Feature[],
  fields: { name: string; type: string }[],
  options: AutoStyleOptions = {},
): LayerStyle {
  const geometryType = options.geometryType ?? 'Polygon'
  const field = options.field ?? pickAutoField(features, fields) ?? ''
  const values = fieldValues(features, field)
  const nums = numericValues(features, field)
  const maxCat = options.maxCategories ?? 12
  const mostlyNumeric = values.length > 0 && nums.length >= values.length * 0.8

  const force = options.kind ?? 'auto'
  const useGraduated =
    force === 'graduated' ||
    (force === 'auto' && mostlyNumeric && uniqueCount(nums) > maxCat)

  let symbol: SymbolSpec
  if (useGraduated && nums.length > 0) {
    const spec: GraduatedSymbolSpec = {
      kind: 'graduated',
      field,
      breaks: graduatedBreaks(nums, options.classes ?? 5, options.method ?? 'jenks', options.ramp ?? 'viridis', options.invert),
      strokeColor: geometryType === 'Polygon' ? '#ffffff' : undefined,
      strokeWidth: geometryType === 'Polygon' ? 0.6 : 2,
    }
    symbol = spec
  } else {
    const spec: CategorizedSymbolSpec = {
      kind: 'categorized',
      field,
      categories: generateCategories(values, rampColors(options.ramp ?? 'okabe-ito', 8, options.invert)),
      defaultColor: '#9ca3af',
      strokeColor: geometryType === 'Polygon' ? '#ffffff' : undefined,
      strokeWidth: geometryType === 'Polygon' ? 0.6 : 2,
    }
    symbol = spec
  }
  return { symbol, label: null }
}
