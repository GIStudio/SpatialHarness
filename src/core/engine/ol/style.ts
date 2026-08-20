/**
 * OpenLayers 样式转换：LayerStyle（引擎无关规范）→ ol StyleFunction。
 * 支持 单一符号 / 分类符号 / 渐变符号 / 标注 / 选中高亮。
 */
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style'
import Feature from 'ol/Feature'
import type { FeatureLike } from 'ol/Feature'
import type { StyleFunction } from 'ol/style/Style'
import type { CategorizedSymbolSpec, GraduatedSymbolSpec, LabelSpec, LayerStyle, SimpleSymbolSpec, SymbolSpec } from '@/core/style/types'

/** 颜色工具：hex → rgba() */
export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.trim()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const num = parseInt(h, 16)
  if (Number.isNaN(num)) return `rgba(158,29,28,${alpha})`
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  return `rgba(${r},${g},${b},${alpha})`
}

const SELECT_STROKE = '#64bbcf'
const SELECT_FILL = 'rgba(100,187,207,0.18)'

interface ResolvedColor {
  fill?: string
  stroke?: string
}

function resolveSymbol(spec: SymbolSpec, feature: FeatureLike): ResolvedColor {
  if (spec.kind === 'simple') {
    return {
      fill: spec.fillColor ?? spec.pointColor,
      stroke: spec.strokeColor ?? spec.pointColor,
    }
  }
  if (spec.kind === 'categorized') {
    return resolveCategorized(spec, feature)
  }
  return resolveGraduated(spec, feature)
}

function resolveCategorized(spec: CategorizedSymbolSpec, feature: FeatureLike): ResolvedColor {
  const raw = feature.get(spec.field)
  const key = raw === null || raw === undefined ? '(空)' : String(raw)
  const cat = spec.categories.find((c) => c.value === key)
  const color = cat?.color ?? spec.defaultColor ?? '#808080'
  return { fill: color, stroke: spec.strokeColor ?? color }
}

function resolveGraduated(spec: GraduatedSymbolSpec, feature: FeatureLike): ResolvedColor {
  const raw = feature.get(spec.field)
  const v = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  if (!Number.isFinite(v)) return { stroke: '#9ca3af' }
  const br = spec.breaks.find((b) => v >= b.min && v <= b.max)
  const color = br?.color ?? '#9ca3af'
  return { fill: color, stroke: spec.strokeColor ?? color }
}

function labelStyle(label: LabelSpec, feature: FeatureLike): Text | undefined {
  if (!label?.field) return undefined
  const raw = feature.get(label.field)
  if (raw === null || raw === undefined) return undefined
  return new Text({
    text: String(raw),
    font: `${label.size ?? 12}px sans-serif`,
    fill: new Fill({ color: label.color ?? '#111827' }),
    stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 2.5 }),
    offsetY: -10,
    overflow: true,
  })
}

function baseStyles(color: ResolvedColor, spec: SymbolSpec, geomType: string): Style[] {
  if (geomType === 'Point') {
    const s = spec.kind === 'simple' ? (spec as SimpleSymbolSpec) : null
    const radius = s?.pointRadius ?? 6
    const fill = new Fill({ color: color.fill ?? '#9e1d1c' })
    let image: CircleStyle | RegularShape
    if (s?.pointSymbol && s.pointSymbol !== 'circle') {
      const rotation = s.pointSymbol === 'triangle' ? Math.PI / 6 : 0
      image = new RegularShape({
        points: s.pointSymbol === 'star' ? 5 : s.pointSymbol === 'triangle' ? 3 : 4,
        radius,
        radius2: s.pointSymbol === 'star' ? radius * 0.45 : undefined,
        angle: rotation,
        fill,
        stroke: new Stroke({ color: color.stroke ?? '#9e1d1c', width: 1.2 }),
      })
    } else {
      image = new CircleStyle({ radius, fill, stroke: new Stroke({ color: color.stroke ?? '#9e1d1c', width: 1.2 }) })
    }
    return [new Style({ image })]
  }
  const stroke = new Stroke({ color: color.stroke ?? '#9e1d1c', width: spec.kind === 'simple' ? (spec as SimpleSymbolSpec).strokeWidth ?? 2 : 2 })
  if (spec.kind === 'simple' && (spec as SimpleSymbolSpec).strokeDash) {
    stroke.setLineDash((spec as SimpleSymbolSpec).strokeDash!)
  }
  if (geomType === 'LineString') {
    return [new Style({ stroke })]
  }
  // Polygon / 其他
  return [
    new Style({
      fill: new Fill({ color: color.fill ? hexToRgba(color.fill, 0.35) : 'rgba(158,29,28,0.35)' }),
      stroke,
    }),
  ]
}

function selectionOverlay(): Style {
  return new Style({
    stroke: new Stroke({ color: SELECT_STROKE, width: 3 }),
    fill: new Fill({ color: SELECT_FILL }),
    image: new CircleStyle({ radius: 8, fill: new Fill({ color: SELECT_FILL }), stroke: new Stroke({ color: SELECT_STROKE, width: 2 }) }),
  })
}

/** LayerStyle + 选中集 → ol StyleFunction */
export function createStyleFunction(
  style: LayerStyle,
  selectedIds: Set<string> | null = null,
): StyleFunction {
  return (feature: FeatureLike): Style[] => {
    const geom = feature.getGeometry()
    const geomType = geom?.getType() ?? 'Point'
    const spec = style.symbol
    const colors = resolveSymbol(spec, feature)
    const styles = baseStyles(colors, spec, geomType)
    const label = labelStyle(style.label ?? { field: '' }, feature)
    if (label) {
      styles[0] = styles[0].clone()
      styles[0].setText(label)
    }
    if (selectedIds && feature instanceof Feature) {
      const id = feature.getId()
      if (id !== undefined && selectedIds.has(String(id))) {
        styles.push(selectionOverlay())
      }
    }
    return styles
  }
}

/** 绘制预览样式 */
export const DRAW_STYLES: Record<'Point' | 'LineString' | 'Polygon', StyleFunction> = {
  Point: () => [
    new Style({
      image: new CircleStyle({
        radius: 5,
        fill: new Fill({ color: '#64bbcf' }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
      }),
    }),
  ],
  LineString: () => [new Style({ stroke: new Stroke({ color: '#64bbcf', width: 2 }) })],
  Polygon: () => [
    new Style({
      fill: new Fill({ color: 'rgba(100,187,207,0.2)' }),
      stroke: new Stroke({ color: '#64bbcf', width: 2 }),
    }),
  ],
}
