/**
 * 样式面板（QGIS 风格符号化）：单一符号 / 分类符号 / 渐变符号 + 标注。
 * 所有修改立即通过 useProjectStore.updateLayer 写回图层 style。
 */
import { Layers, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react'
import {
  Button,
  ColorInput,
  CollapseSection,
  EmptyState,
  Field,
  IconButton,
  Select,
  SectionTitle,
  Slider,
  Toggle,
  cn,
} from '@/components/ui/primitives'
import { useSelectionStore } from '@/state/selection'
import { useProjectStore } from '@/state/project'
import { useUiStore } from '@/state/ui'
import type { VectorGeometryType, VectorLayerModel } from '@/core/layers/model'
import {
  DEFAULT_PALETTE,
  equalIntervalBreaks,
  generateCategories,
  type CategorizedSymbolSpec,
  type GraduatedSymbolSpec,
  type LayerStyle,
  type SimpleSymbolSpec,
  type SymbolKind,
  type SymbolSpec,
} from '@/core/style/types'

// ---------------- 颜色小工具 ----------------

function normalizeHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return '#e6194b'
}

/** 从任意颜色字符串解析出规范化 hex（支持 #rgb/#rrggbb/rgb()/rgba()） */
function hexFromColor(color: string): string {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color.trim())
  if (!m) return normalizeHex(color)
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${toHex(Number(m[1]))}${toHex(Number(m[2]))}${toHex(Number(m[3]))}`
}

/** 从 rgba() 字符串解析透明度百分比（0–100），非 rgba 视为不透明 */
function alphaOf(color: string): number {
  const m = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(color.trim())
  if (!m) return 100
  return Math.round(Math.max(0, Math.min(1, parseFloat(m[1]))) * 100)
}

/** hex + 透明度百分比 → 'rgba(r,g,b,a)' */
function hexToRgba(hex: string, alphaPercent: number): string {
  const h = normalizeHex(hex).slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = Math.max(0, Math.min(1, alphaPercent / 100))
  return `rgba(${r},${g},${b},${a})`
}

// ---------------- 样式工具 ----------------

/** 按几何类型给出简单符号默认样式（与导入时的默认样式一致） */
function defaultSimpleStyle(geometryType: VectorGeometryType): LayerStyle {
  switch (geometryType) {
    case 'Point':
      return { symbol: { kind: 'simple', pointRadius: 6, pointColor: '#e6194b' }, label: null }
    case 'LineString':
      return { symbol: { kind: 'simple', strokeColor: '#e6194b', strokeWidth: 2 }, label: null }
    case 'Polygon':
      return {
        symbol: { kind: 'simple', fillColor: 'rgba(230,25,75,0.3)', strokeColor: '#e6194b', strokeWidth: 1.5 },
        label: null,
      }
    default:
      return { symbol: { kind: 'simple', pointRadius: 6, pointColor: '#e6194b' }, label: null }
  }
}

/** 字段全部非空值 */
function fieldValues(layer: VectorLayerModel, field: string): unknown[] {
  const out: unknown[] = []
  for (const f of layer.features) {
    const v = f.properties?.[field]
    if (v === null || v === undefined || v === '') continue
    out.push(v)
  }
  return out
}

/** 字段数值（number 且有限） */
function numericFieldValues(layer: VectorLayerModel, field: string): number[] {
  const out: number[] = []
  for (const f of layer.features) {
    const v = f.properties?.[field]
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}

function fmtNum(n: number): string {
  return Number.isFinite(n) ? String(Number(n.toFixed(4))) : '—'
}

/** 删除 strokeDash 键（虚线关闭） */
function withoutDash(spec: SimpleSymbolSpec): SimpleSymbolSpec {
  const next: SimpleSymbolSpec = { ...spec }
  delete next.strokeDash
  return next
}

// ---------------- 单一符号控件 ----------------

function PointControls({
  symbol,
  onChange,
}: {
  symbol: SimpleSymbolSpec
  onChange: (patch: Partial<SimpleSymbolSpec>) => void
}) {
  return (
    <>
      <Field label="形状">
        <Select
          value={symbol.pointSymbol ?? 'circle'}
          onChange={(v) => onChange({ pointSymbol: v as SimpleSymbolSpec['pointSymbol'] })}
          options={[
            { value: 'circle', label: '圆形' },
            { value: 'square', label: '方形' },
            { value: 'triangle', label: '三角形' },
            { value: 'star', label: '星形' },
          ]}
        />
      </Field>
      <Field label="颜色">
        <ColorInput value={symbol.pointColor ?? '#e6194b'} onChange={(v) => onChange({ pointColor: v })} />
      </Field>
      <Field label="半径">
        <Slider value={symbol.pointRadius ?? 6} min={2} max={16} onChange={(v) => onChange({ pointRadius: v })} />
      </Field>
    </>
  )
}

function LineControls({
  symbol,
  onChange,
}: {
  symbol: SimpleSymbolSpec
  onChange: (patch: Partial<SimpleSymbolSpec>) => void
}) {
  return (
    <>
      <Field label="颜色">
        <ColorInput value={symbol.strokeColor ?? '#e6194b'} onChange={(v) => onChange({ strokeColor: v })} />
      </Field>
      <Field label="宽度">
        <Slider value={symbol.strokeWidth ?? 2} min={0.5} max={10} step={0.5} onChange={(v) => onChange({ strokeWidth: v })} />
      </Field>
      <Field label="虚线">
        <Toggle
          checked={symbol.strokeDash !== undefined}
          onChange={(on) => {
            if (on) onChange({ strokeDash: [6, 4] })
            else onChange(withoutDash(symbol))
          }}
        />
      </Field>
    </>
  )
}

function PolygonControls({
  symbol,
  onChange,
}: {
  symbol: SimpleSymbolSpec
  onChange: (patch: Partial<SimpleSymbolSpec>) => void
}) {
  const fill = symbol.fillColor ?? '#e6194b'
  const hex = hexFromColor(fill)
  const alpha = alphaOf(fill)
  return (
    <>
      <Field label="填充颜色">
        <ColorInput value={hex} onChange={(v) => onChange({ fillColor: hexToRgba(v, alpha) })} />
      </Field>
      <Field label="填充透明度">
        <Slider value={alpha} min={0} max={100} onChange={(a) => onChange({ fillColor: hexToRgba(hex, a) })} />
      </Field>
      <Field label="描边颜色">
        <ColorInput value={symbol.strokeColor ?? '#e6194b'} onChange={(v) => onChange({ strokeColor: v })} />
      </Field>
      <Field label="描边宽度">
        <Slider value={symbol.strokeWidth ?? 1.5} min={0.5} max={10} step={0.5} onChange={(v) => onChange({ strokeWidth: v })} />
      </Field>
    </>
  )
}

// ---------------- 分类符号 ----------------

function CategorizedControls({
  symbol,
  layer,
  onChange,
}: {
  symbol: CategorizedSymbolSpec
  layer: VectorLayerModel
  onChange: (patch: Partial<CategorizedSymbolSpec>) => void
}) {
  const fieldOptions = layer.fields.map((f) => ({ value: f.name, label: f.name }))

  const onFieldChange = (v: string) => {
    onChange({ field: v })
    if (fieldValues(layer, v).length === 0) {
      useUiStore.getState().flash(`字段「${v}」没有可用数据`, 'warn')
    }
  }

  const onAutoClassify = () => {
    const values = fieldValues(layer, symbol.field)
    if (values.length === 0) {
      useUiStore.getState().flash('所选字段没有可用数据', 'warn')
      return
    }
    onChange({ categories: generateCategories(values) })
  }

  const onAddCategory = () => {
    const color = DEFAULT_PALETTE[symbol.categories.length % DEFAULT_PALETTE.length]
    onChange({ categories: [...symbol.categories, { value: '新分类', label: '新分类', color }] })
  }

  const onCategoryColor = (i: number, color: string) =>
    onChange({ categories: symbol.categories.map((c, j) => (j === i ? { ...c, color } : c)) })

  const onRemoveCategory = (i: number) => onChange({ categories: symbol.categories.filter((_, j) => j !== i) })

  return (
    <>
      <Field label="分类字段">
        <Select value={symbol.field} onChange={onFieldChange} options={fieldOptions} />
      </Field>
      <Button icon={<Wand2 size={13} />} onClick={onAutoClassify} className="w-full">
        自动分类
      </Button>
      {symbol.categories.length > 0 && (
        <div className="flex flex-col gap-1">
          {symbol.categories.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <ColorInput value={c.color} onChange={(color) => onCategoryColor(i, color)} className="flex-1" />
              <span className="w-16 shrink-0 truncate text-xs text-text" title={c.value}>
                {c.value}
              </span>
              <IconButton title="删除分类" icon={<Trash2 size={13} />} onClick={() => onRemoveCategory(i)} />
            </div>
          ))}
        </div>
      )}
      <Button variant="outline" icon={<Plus size={13} />} onClick={onAddCategory} className="w-full">
        添加分类
      </Button>
      <Field label="未匹配默认色">
        <ColorInput value={symbol.defaultColor ?? '#808080'} onChange={(v) => onChange({ defaultColor: v })} />
      </Field>
    </>
  )
}

// ---------------- 渐变符号 ----------------

function GraduatedControls({
  symbol,
  layer,
  onChange,
}: {
  symbol: GraduatedSymbolSpec
  layer: VectorLayerModel
  onChange: (patch: Partial<GraduatedSymbolSpec>) => void
}) {
  // 渐变仅支持数值字段
  const fieldOptions = layer.fields
    .filter((f) => f.type === 'number')
    .map((f) => ({ value: f.name, label: f.name }))
  const count = symbol.breaks.length >= 3 && symbol.breaks.length <= 9 ? symbol.breaks.length : 5

  const onFieldChange = (v: string) => {
    onChange({ field: v })
    if (numericFieldValues(layer, v).length === 0) {
      useUiStore.getState().flash(`字段「${v}」没有数值数据`, 'warn')
    }
  }

  const applyBreaks = (n: number) => {
    const nums = numericFieldValues(layer, symbol.field)
    if (nums.length === 0) {
      useUiStore.getState().flash('所选字段没有数值数据', 'warn')
      return
    }
    onChange({ breaks: equalIntervalBreaks(nums, n) })
  }

  return (
    <>
      <Field label="渐变字段">
        <Select value={symbol.field} onChange={onFieldChange} options={fieldOptions} />
      </Field>
      <div className="flex items-end gap-1.5">
        <Field label="分级数" className="flex-1">
          <Select
            value={String(count)}
            onChange={(v) => applyBreaks(Number(v))}
            options={Array.from({ length: 7 }, (_, i) => i + 3).map((n) => ({ value: String(n), label: `${n} 级` }))}
          />
        </Field>
        <Button icon={<Wand2 size={13} />} onClick={() => applyBreaks(count)}>
          自动分档
        </Button>
      </div>
      {symbol.breaks.length > 0 && (
        <div className="flex flex-col gap-1">
          {symbol.breaks.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="w-20 shrink-0 font-mono text-[11px] text-text-dim">
                {fmtNum(b.min)} – {fmtNum(b.max)}
              </span>
              <ColorInput
                value={b.color}
                onChange={(color) =>
                  onChange({ breaks: symbol.breaks.map((bb, j) => (j === i ? { ...bb, color } : bb)) })
                }
                className="flex-1"
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ---------------- 主面板 ----------------

const KIND_TABS: { kind: SymbolKind; label: string }[] = [
  { kind: 'simple', label: '单一符号' },
  { kind: 'categorized', label: '分类符号' },
  { kind: 'graduated', label: '渐变符号' },
]

/** 符号增量补丁（不含 kind，避免展开联合类型时污染 kind） */
type SymbolPatch = Partial<Omit<SymbolSpec, 'kind'>>

export default function StylePanel() {
  const activeLayerId = useSelectionStore((s) => s.activeLayerId)
  const layer = useProjectStore((s) => (activeLayerId ? s.layers.find((l) => l.id === activeLayerId) : undefined))
  const updateLayer = useProjectStore((s) => s.updateLayer)

  const vectorLayer = layer && layer.kind === 'vector' ? layer : undefined

  if (!vectorLayer) {
    return (
      <EmptyState
        icon={<Layers size={18} />}
        title="选择矢量图层以编辑样式"
        hint="请在左侧图层列表中选择一个矢量图层"
      />
    )
  }

  const { style } = vectorLayer
  const symbol = style.symbol
  const fieldOptions = vectorLayer.fields.map((f) => ({ value: f.name, label: f.name }))

  const commit = (next: LayerStyle) => updateLayer(vectorLayer.id, { style: next })
  const patchSymbol = (patch: SymbolPatch) => commit({ ...style, symbol: { ...symbol, ...patch } as SymbolSpec })

  const switchKind = (kind: SymbolKind) => {
    if (kind === symbol.kind) return
    let next: SymbolSpec
    if (kind === 'simple') {
      next = defaultSimpleStyle(vectorLayer.geometryType).symbol
    } else if (kind === 'categorized') {
      next = {
        kind: 'categorized',
        field: vectorLayer.fields[0]?.name ?? '',
        categories: [],
        defaultColor: '#808080',
        strokeColor: symbol.strokeColor,
        strokeWidth: symbol.strokeWidth,
      }
    } else {
      next = {
        kind: 'graduated',
        field: vectorLayer.fields.find((f) => f.type === 'number')?.name ?? '',
        breaks: [],
        strokeColor: symbol.strokeColor,
        strokeWidth: symbol.strokeWidth,
      }
    }
    commit({ ...style, symbol: next })
  }

  const reset = () => commit(defaultSimpleStyle(vectorLayer.geometryType))

  const mixed = vectorLayer.geometryType === 'Mixed' || vectorLayer.geometryType === 'None'
  const showPoint = mixed || vectorLayer.geometryType === 'Point'
  const showLine = mixed || vectorLayer.geometryType === 'LineString'
  const showPolygon = mixed || vectorLayer.geometryType === 'Polygon'

  const label = style.label

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex gap-1">
        {KIND_TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => switchKind(t.kind)}
            className={cn(
              'flex-1 rounded-md border px-1 py-1 text-xs transition-colors',
              symbol.kind === t.kind
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border text-text-dim hover:bg-panel-2 hover:text-text',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {symbol.kind === 'simple' && (
        <div className="flex flex-col gap-2">
          {showPoint && (
            <div className="flex flex-col gap-2">
              {mixed && <SectionTitle>点符号</SectionTitle>}
              <PointControls symbol={symbol} onChange={patchSymbol} />
            </div>
          )}
          {showLine && (
            <div className="flex flex-col gap-2">
              {mixed && <SectionTitle>线符号</SectionTitle>}
              <LineControls symbol={symbol} onChange={patchSymbol} />
            </div>
          )}
          {showPolygon && (
            <div className="flex flex-col gap-2">
              {mixed && <SectionTitle>面符号</SectionTitle>}
              <PolygonControls symbol={symbol} onChange={patchSymbol} />
            </div>
          )}
        </div>
      )}

      {symbol.kind === 'categorized' && (
        <CategorizedControls symbol={symbol} layer={vectorLayer} onChange={patchSymbol} />
      )}

      {symbol.kind === 'graduated' && (
        <GraduatedControls symbol={symbol} layer={vectorLayer} onChange={patchSymbol} />
      )}

      <CollapseSection title="标注">
        <div className="flex flex-col gap-2">
          <Field label="启用标注">
            <Toggle
              checked={label !== null}
              onChange={(on) =>
                commit(
                  on
                    ? { ...style, label: { field: vectorLayer.fields[0]?.name ?? '', size: 12, color: '#ffffff' } }
                    : { ...style, label: null },
                )
              }
            />
          </Field>
          {label && (
            <>
              <Field label="字段">
                <Select value={label.field} onChange={(v) => commit({ ...style, label: { ...label, field: v } })} options={fieldOptions} />
              </Field>
              <Field label="字号">
                <Slider value={label.size ?? 12} min={8} max={20} onChange={(v) => commit({ ...style, label: { ...label, size: v } })} />
              </Field>
              <Field label="颜色">
                <ColorInput value={label.color ?? '#ffffff'} onChange={(v) => commit({ ...style, label: { ...label, color: v } })} />
              </Field>
            </>
          )}
        </div>
      </CollapseSection>

      <div className="mt-1 border-t border-border/60 pt-2">
        <Button variant="outline" icon={<RotateCcw size={13} />} onClick={reset} className="w-full">
          重置样式
        </Button>
      </div>
    </div>
  )
}
