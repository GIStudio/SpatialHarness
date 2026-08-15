/**
 * 空间分析面板：选择图层与算子，调用 Web Worker 中的 turf 分析（runAnalysis）。
 * - 矢量结果 → 作为新图层加入工程并缩放至该图层
 * - 表格结果 → 面板内渲染结果表格
 * - 错误 → 红色错误框 + flash
 */
import { useEffect, useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import type { Feature } from 'geojson'
import {
  Field,
  Select,
  NumberInput,
  Button,
  Spinner,
  EmptyState,
  SectionTitle,
  Checkbox,
  CollapseSection,
  cn,
} from '@/components/ui/primitives'
import {
  OP_LABELS,
  resultLayerName,
  type AnalysisOp,
  type AnalysisTableResult,
  type BufferUnit,
} from '@/core/analysis/types'
import { runAnalysis } from '@/core/analysis/service'
import { useProjectStore } from '@/state/project'
import { useSelectionStore } from '@/state/selection'
import { useUiStore } from '@/state/ui'
import { engineFitToLayer } from '@/state/engineBridge'
import {
  uid,
  inferLayerMeta,
  isVectorLayer,
  type VectorLayerModel,
  type VectorGeometryType,
} from '@/core/layers/model'
import { DEFAULT_PALETTE, type LayerStyle } from '@/core/style/types'

/** 各算子一行简短说明 */
const OP_HINTS: Record<AnalysisOp['op'], string> = {
  buffer: '为要素生成指定距离的缓冲区多边形',
  intersect: '计算两个面图层的交集',
  union: '合并两个图层的几何（重叠合并）',
  difference: '用图层 A 减去图层 B',
  clip: '用 B 图层裁剪 A（点/面）',
  dissolve: '按字段合并相邻要素',
  centroid: '生成各要素质心点',
  fieldStats: '字段数值统计',
  layerStats: '图层整体统计',
  bbox: '生成外包矩形图层',
}

const OP_OPTIONS = (Object.keys(OP_LABELS) as AnalysisOp['op'][]).map((op) => ({
  value: op,
  label: OP_LABELS[op],
}))

const BUFFER_UNIT_OPTIONS: { value: BufferUnit; label: string }[] = [
  { value: 'meters', label: '米' },
  { value: 'kilometers', label: '千米' },
  { value: 'miles', label: '英里' },
]

/** 按几何类型生成简单默认样式（DEFAULT_PALETTE 首色） */
function defaultStyle(geometryType: VectorGeometryType): LayerStyle {
  const color = DEFAULT_PALETTE[0]
  if (geometryType === 'Point') {
    return { symbol: { kind: 'simple', pointSymbol: 'circle', pointRadius: 5, pointColor: color }, label: null }
  }
  if (geometryType === 'LineString') {
    return { symbol: { kind: 'simple', strokeColor: color, strokeWidth: 2 }, label: null }
  }
  // Polygon / Mixed / None → 面填充
  return { symbol: { kind: 'simple', fillColor: color, strokeColor: color, strokeWidth: 1 }, label: null }
}

interface HistoryEntry {
  time: number
  opLabel: string
  summary: string
}

function TableResultView({ table }: { table: AnalysisTableResult }) {
  return (
    <div className="max-h-[200px] overflow-auto rounded-md border border-border bg-panel-2">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th
                key={c}
                className="sticky top-0 border-b border-border bg-panel-3 px-2 py-1 text-left font-medium whitespace-nowrap text-text-dim"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="odd:bg-panel-2/40 hover:bg-panel-3/50">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    'border-b border-border/40 px-2 py-1 whitespace-nowrap',
                    typeof cell === 'number' ? 'font-mono text-right text-text' : 'text-text-dim',
                  )}
                >
                  {cell === null || cell === undefined ? '' : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AnalysisPanel() {
  const layers = useProjectStore((s) => s.layers)
  const addLayer = useProjectStore((s) => s.addLayer)
  const activeLayerId = useSelectionStore((s) => s.activeLayerId)
  const setActiveLayer = useSelectionStore((s) => s.setActiveLayer)
  const flash = useUiStore((s) => s.flash)

  const vectorLayers = useMemo(() => layers.filter(isVectorLayer), [layers])

  // ---------------- 表单状态 ----------------
  const [op, setOp] = useState<AnalysisOp['op']>('buffer')
  const [layerA, setLayerA] = useState<string>(() => {
    const sel = useSelectionStore.getState().activeLayerId
    const vecs = useProjectStore.getState().layers.filter(isVectorLayer)
    if (sel && vecs.some((l) => l.id === sel)) return sel
    return vecs[0]?.id ?? ''
  })
  const [layerB, setLayerB] = useState<string>('')
  const [bufferDistance, setBufferDistance] = useState(10)
  const [bufferUnit, setBufferUnit] = useState<BufferUnit>('meters')
  const [bufferDissolve, setBufferDissolve] = useState(false)
  const [dissolveField, setDissolveField] = useState('')
  const [statsField, setStatsField] = useState('')

  const [running, setRunning] = useState(false)
  const [tableResult, setTableResult] = useState<AnalysisTableResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])

  // 图层 A 失效时回退：activeLayerId → 第一个矢量层
  useEffect(() => {
    setLayerA((prev) => {
      if (prev && vectorLayers.some((l) => l.id === prev)) return prev
      if (activeLayerId && vectorLayers.some((l) => l.id === activeLayerId)) return activeLayerId
      return vectorLayers[0]?.id ?? ''
    })
  }, [vectorLayers, activeLayerId])

  // ---------------- 派生值 ----------------
  const aOptions = useMemo(
    () => vectorLayers.map((l) => ({ value: l.id, label: `${l.name}（${l.features.length} 要素）` })),
    [vectorLayers],
  )

  const otherLayers = useMemo(() => vectorLayers.filter((l) => l.id !== layerA), [vectorLayers, layerA])
  const bOptions = useMemo(
    () => otherLayers.map((l) => ({ value: l.id, label: `${l.name}（${l.features.length} 要素）` })),
    [otherLayers],
  )
  // B 图层：排除与 A 相同，失效时回退到第一个可用图层
  const effectiveB =
    layerB && layerB !== layerA && otherLayers.some((l) => l.id === layerB) ? layerB : (otherLayers[0]?.id ?? '')

  const layerAFields = useMemo(() => {
    const layer = vectorLayers.find((l) => l.id === layerA)
    return layer ? layer.fields : []
  }, [vectorLayers, layerA])
  const allFieldNames = useMemo(() => layerAFields.map((f) => f.name), [layerAFields])
  const numFieldNames = useMemo(
    () => layerAFields.filter((f) => f.type === 'number').map((f) => f.name),
    [layerAFields],
  )
  const effectiveDissolveField = dissolveField && allFieldNames.includes(dissolveField) ? dissolveField : ''
  const effectiveStatsField = statsField && numFieldNames.includes(statsField) ? statsField : (numFieldNames[0] ?? '')

  const nameOf = (id: string) => vectorLayers.find((l) => l.id === id)?.name ?? id

  function buildOp(): AnalysisOp | null {
    if (!layerA) return null
    switch (op) {
      case 'buffer':
        if (!(Number.isFinite(bufferDistance) && bufferDistance > 0)) return null
        return { op: 'buffer', layerId: layerA, distance: bufferDistance, unit: bufferUnit, dissolve: bufferDissolve }
      case 'intersect':
      case 'union':
      case 'difference':
        if (!effectiveB) return null
        return { op, layerA, layerB: effectiveB }
      case 'clip':
        if (!effectiveB) return null
        return { op: 'clip', layerId: layerA, clipLayerId: effectiveB }
      case 'dissolve':
        return effectiveDissolveField
          ? { op: 'dissolve', layerId: layerA, field: effectiveDissolveField }
          : { op: 'dissolve', layerId: layerA }
      case 'fieldStats':
        if (!effectiveStatsField) return null
        return { op: 'fieldStats', layerId: layerA, field: effectiveStatsField }
      case 'centroid':
      case 'layerStats':
      case 'bbox':
        return { op, layerId: layerA }
    }
  }

  const canRun = useMemo(() => {
    if (!layerA || vectorLayers.length === 0) return false
    switch (op) {
      case 'buffer':
        return Number.isFinite(bufferDistance) && bufferDistance > 0
      case 'intersect':
      case 'union':
      case 'difference':
      case 'clip':
        return effectiveB !== ''
      case 'fieldStats':
        return effectiveStatsField !== ''
      case 'dissolve':
      case 'centroid':
      case 'layerStats':
      case 'bbox':
        return true
    }
  }, [op, layerA, vectorLayers, bufferDistance, effectiveB, effectiveStatsField])

  // ---------------- 运行 ----------------
  const record = (opLabel: string, summary: string) =>
    setHistory((h) => [{ time: Date.now(), opLabel, summary }, ...h].slice(0, 10))

  const run = async () => {
    const analysisOp = buildOp()
    if (!analysisOp) return
    setRunning(true)
    setError(null)
    setTableResult(null)

    // 只传本算子需要的图层要素
    const layersIn: Record<string, Feature[]> = {}
    const aLayer = vectorLayers.find((l) => l.id === layerA)
    if (aLayer) layersIn[layerA] = aLayer.features
    const bLayer = vectorLayers.find((l) => l.id === effectiveB)
    if (bLayer) layersIn[effectiveB] = bLayer.features

    try {
      const outcome = await runAnalysis(analysisOp, layersIn)
      if (!outcome.ok) {
        setError(outcome.error)
        flash(outcome.error, 'error')
        record(OP_LABELS[analysisOp.op], `失败：${outcome.error}`)
        return
      }
      if (outcome.kind === 'vector') {
        const meta = inferLayerMeta(outcome.features)
        const names: Record<string, string> = { [layerA]: nameOf(layerA) }
        if (effectiveB) names[effectiveB] = nameOf(effectiveB)
        const layerName = resultLayerName(analysisOp, names)
        const model: VectorLayerModel = {
          id: uid('lyr'),
          name: layerName,
          kind: 'vector',
          geometryType: meta.geometryType,
          features: outcome.features,
          fields: outcome.fields,
          style: defaultStyle(meta.geometryType),
          sourceCrs: outcome.sourceCrs,
          visible: true,
          opacity: 1,
          zIndex: layers.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          editable: true,
        }
        addLayer(model)
        engineFitToLayer(model.id)
        setActiveLayer(model.id)
        flash(`分析完成：${outcome.features.length} 个要素`, 'ok')
        record(OP_LABELS[analysisOp.op], `生成 ${outcome.features.length} 个要素 → ${layerName}`)
      } else {
        setTableResult(outcome.table)
        flash(`分析完成：${outcome.table.rows.length} 行`, 'ok')
        record(
          OP_LABELS[analysisOp.op],
          `表格 ${outcome.table.columns.length} 列 × ${outcome.table.rows.length} 行`,
        )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      flash(msg, 'error')
      record(OP_LABELS[analysisOp.op], `失败：${msg}`)
    } finally {
      setRunning(false)
    }
  }

  // ---------------- 渲染 ----------------
  if (vectorLayers.length === 0) {
    return (
      <div className="h-full">
        <EmptyState
          icon={<FlaskConical size={20} />}
          title="先导入矢量数据"
          hint="导入 GeoJSON / Shapefile / KML / GPX 等矢量文件后即可进行空间分析"
        />
      </div>
    )
  }

  const binaryOps: AnalysisOp['op'][] = ['intersect', 'union', 'difference']

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2">
      <SectionTitle>分析工具</SectionTitle>

      <Field label="图层 A">
        <Select value={layerA} onChange={setLayerA} options={aOptions} />
      </Field>

      <Field label="分析算子">
        <Select value={op} onChange={(v) => setOp(v as AnalysisOp['op'])} options={OP_OPTIONS} />
      </Field>
      <p className="-mt-1 text-[11px] leading-relaxed text-text-faint">{OP_HINTS[op]}</p>

      {op === 'buffer' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Field label="距离">
              <NumberInput value={bufferDistance} onChange={setBufferDistance} min={0.1} step={0.1} />
            </Field>
            <Field label="单位">
              <Select value={bufferUnit} onChange={(v) => setBufferUnit(v as BufferUnit)} options={BUFFER_UNIT_OPTIONS} />
            </Field>
          </div>
          <Checkbox checked={bufferDissolve} onChange={setBufferDissolve} label="融合重叠缓冲区" />
        </>
      )}

      {binaryOps.includes(op) && (
        <Field label="图层 B">
          <Select
            value={effectiveB}
            onChange={setLayerB}
            options={bOptions.length ? bOptions : [{ value: '', label: '（需要至少两个图层）' }]}
          />
        </Field>
      )}

      {op === 'clip' && (
        <Field label="裁剪图层">
          <Select
            value={effectiveB}
            onChange={setLayerB}
            options={bOptions.length ? bOptions : [{ value: '', label: '（需要至少两个图层）' }]}
          />
        </Field>
      )}

      {op === 'dissolve' && (
        <Field label="融合字段（可选）">
          <Select
            value={effectiveDissolveField}
            onChange={setDissolveField}
            options={[
              { value: '', label: '全部融合（不按字段）' },
              ...allFieldNames.map((f) => ({ value: f, label: f })),
            ]}
          />
        </Field>
      )}

      {op === 'fieldStats' && (
        <Field label="统计字段">
          <Select
            value={effectiveStatsField}
            onChange={setStatsField}
            options={
              numFieldNames.length
                ? numFieldNames.map((f) => ({ value: f, label: f }))
                : [{ value: '', label: '（该图层没有数值字段）' }]
            }
          />
        </Field>
      )}

      <Button
        variant="primary"
        size="md"
        className="w-full"
        disabled={!canRun || running}
        onClick={() => void run()}
        icon={running ? <Spinner /> : <FlaskConical size={14} />}
      >
        {running ? '分析中…' : '开始分析'}
      </Button>

      {tableResult && <TableResultView table={tableResult} />}

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs break-words text-danger">
          {error}
        </div>
      )}

      <CollapseSection title={`历史记录（${history.length}）`} defaultOpen={false}>
        {history.length === 0 ? (
          <div className="py-2 text-center text-[11px] text-text-faint">暂无分析记录</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {history.map((h, i) => (
              <li key={i} className="rounded border border-border/60 bg-panel-2 px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-text">{h.opLabel}</span>
                  <span className="text-[10px] text-text-faint">
                    {new Date(h.time).toLocaleTimeString('zh-CN', { hour12: false })}
                  </span>
                </div>
                <div className="truncate text-[11px] text-text-dim">{h.summary}</div>
              </li>
            ))}
          </ul>
        )}
      </CollapseSection>
    </div>
  )
}
