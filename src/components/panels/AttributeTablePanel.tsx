/**
 * 属性表面板（QGIS 风格）：虚拟滚动 + 排序 + 筛选 + 单元格编辑。
 *
 * 数据源：useSelectionStore.activeLayerId → useProjectStore.layers。
 * 排序/筛选为组件本地状态（初始取自 layer.tableState，不回写 store）。
 * 单元格编辑仅对 layer.editable 的矢量图层开放，提交后写回 project store 并压入撤销栈。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type UIEvent,
} from 'react'
import { ArrowDown, ArrowUp, MapPin, Search, Shapes, Spline, Table2, X } from 'lucide-react'
import type { Feature } from 'geojson'
import { useSelectionStore } from '@/state/selection'
import { useProjectStore } from '@/state/project'
import { featuresCommand, useHistoryStore } from '@/state/history'
import { Button, EmptyState, TextInput, cn } from '@/components/ui/primitives'
import type { VectorLayerModel } from '@/core/layers/model'

const ROW_HEIGHT = 26
const BUFFER = 20
const ID_MAX = 14

type SortDir = 'asc' | 'desc'
type SortState = { by: string; dir: SortDir } | null

/** 任意值 → 可搜索/展示的字符串（对象走 JSON） */
function stringifyValue(v: unknown): string {
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

/** 排序比较：null/undefined 恒排最后 */
function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined
  const bNull = b === null || b === undefined
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }
  return stringifyValue(a).localeCompare(stringifyValue(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

/** 几何类型 → 小图标（Multi* 与单几何同样式） */
function geometryIcon(g: Feature['geometry']) {
  if (!g) return null
  switch (g.type) {
    case 'Point':
    case 'MultiPoint':
      return <MapPin size={12} className="text-accent" />
    case 'LineString':
    case 'MultiLineString':
      return <Spline size={12} className="text-ok" />
    case 'Polygon':
    case 'MultiPolygon':
      return <Shapes size={12} className="text-warn" />
    default:
      return <span className="px-1 text-[9px] text-text-faint">{g.type}</span>
  }
}

function truncateId(id: string | number | undefined | null): string {
  if (id === undefined || id === null) return '—'
  const s = String(id)
  return s.length > ID_MAX ? `${s.slice(0, ID_MAX)}…` : s
}

function AttributeTablePanel() {
  const activeLayerId = useSelectionStore((s) => s.activeLayerId)
  const layers = useProjectStore((s) => s.layers)
  const layer = layers.find((l) => l.id === activeLayerId)

  if (!layer || layer.kind !== 'vector') {
    return (
      <EmptyState icon={<Table2 size={26} />} title="未选择矢量图层" hint="在左侧图层面板选择矢量图层" />
    )
  }
  return <VectorTable key={layer.id} layer={layer} />
}

// 默认导出（任务规格）+ 命名导出（兼容并行开发中的 RightPanel 命名导入）
export default AttributeTablePanel
export { AttributeTablePanel }

function VectorTable({ layer }: { layer: VectorLayerModel }) {
  const { id: layerId, features, fields, editable } = layer

  const [sort, setSort] = useState<SortState>(() => {
    const t = layer.tableState
    return t?.sortBy && t.sortDir ? { by: t.sortBy, dir: t.sortDir } : null
  })
  const [filter, setFilter] = useState(() => layer.tableState?.filter ?? '')
  const [editing, setEditing] = useState<{ featureId: string; field: string; draft: string } | null>(
    null,
  )
  // 编辑状态镜像：同步置空防止 Enter 提交后 blur 重复提交
  const editingRef = useRef<{ featureId: string; field: string; draft: string } | null>(null)
  useEffect(() => {
    editingRef.current = editing
  }, [editing])

  const selection = useSelectionStore((s) => s.byLayer[layerId])
  const setSelection = useSelectionStore((s) => s.set)
  const clearSelection = useSelectionStore((s) => s.clear)
  const replaceFeatures = useProjectStore((s) => s.replaceFeatures)

  // 虚拟滚动：scrollTop + 视口高度
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewportH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 筛选/排序变化后回到顶部
  useEffect(() => {
    setScrollTop(0)
  }, [filter, sort])

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
    setViewportH(e.currentTarget.clientHeight)
  }, [])

  const selectedSet = useMemo(() => new Set(selection ?? []), [selection])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return features
    return features.filter((f) => {
      const props = f.properties
      if (!props) return false
      return Object.values(props).some((v) => {
        if (v === null || v === undefined) return false
        return stringifyValue(v).toLowerCase().includes(q)
      })
    })
  }, [features, filter])

  const rows = useMemo(() => {
    if (!sort) return filtered
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = sort.by === '__id' ? a.id : a.properties?.[sort.by]
      const bv = sort.by === '__id' ? b.id : b.properties?.[sort.by]
      return compareValues(av, bv) * dir
    })
  }, [filtered, sort])

  const total = rows.length
  const winStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER)
  const winEnd = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT) + BUFFER)
  const visible = rows.slice(winStart, winEnd)

  const cycleSort = useCallback((by: string) => {
    setSort((prev) => {
      if (!prev || prev.by !== by) return { by, dir: 'asc' }
      return prev.dir === 'asc' ? { by, dir: 'desc' } : null
    })
  }, [])

  const toggleRow = useCallback(
    (id: string) => {
      const cur = selection ?? []
      setSelection(layerId, cur.includes(id) ? cur.filter((x) => x !== id) : [id])
    },
    [selection, layerId, setSelection],
  )

  const startEdit = useCallback((featureId: string, field: string, raw: unknown) => {
    setEditing({
      featureId,
      field,
      draft: raw === null || raw === undefined ? '' : stringifyValue(raw),
    })
  }, [])

  const commitEdit = useCallback(() => {
    const ed = editingRef.current
    if (!ed) return
    editingRef.current = null
    setEditing(null)
    const { featureId, field, draft } = ed
    const before = layer.features
    const target = before.find((f) => String(f.id) === featureId)
    if (!target) return
    const raw = target.properties?.[field]
    let value: unknown = draft
    if (typeof raw === 'number') {
      const n = parseFloat(draft)
      if (Number.isFinite(n)) value = n
      // NaN → 保留字符串
    }
    const newFeatures = before.map((f) =>
      f === target ? { ...f, properties: { ...(f.properties ?? {}), [field]: value } } : f,
    )
    replaceFeatures(layerId, newFeatures)
    useHistoryStore.getState().push(featuresCommand(layerId, '编辑属性', before, newFeatures))
  }, [layer, layerId, replaceFeatures])

  const cancelEdit = useCallback(() => {
    editingRef.current = null
    setEditing(null)
  }, [])

  const onEditKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEdit()
      }
    },
    [commitEdit, cancelEdit],
  )

  const colTemplate = useMemo(
    () => ['36px', '130px', ...fields.map(() => 'minmax(150px, 1fr)')].join(' '),
    [fields],
  )

  const selectedCount = selection?.length ?? 0
  const visStart = Math.max(0, Math.min(total, Math.floor(scrollTop / ROW_HEIGHT)))
  const visEnd = Math.max(visStart, Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_HEIGHT)))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1.5">
        <span className="shrink-0 text-[11px] text-text-dim">
          {rows.length} 行 · 选中 {selectedCount} 个
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="relative shrink-0">
            <Search
              size={12}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-faint"
            />
            <TextInput value={filter} onChange={setFilter} placeholder="筛选…" className="w-40 pl-6" />
          </div>
          <Button
            variant="ghost"
            size="xs"
            icon={<X size={12} />}
            disabled={selectedCount === 0}
            onClick={clearSelection}
            title="清除选择"
          >
            清除选择
          </Button>
        </div>
      </div>

      {/* 表头（sticky）+ 虚拟滚动行 */}
      <div ref={scrollRef} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="sticky top-0 z-10 grid border-b border-border bg-panel-2 text-[11px] font-medium text-text-dim"
          style={{ gridTemplateColumns: colTemplate }}
        >
          <div className="px-2 py-1 text-center">几何</div>
          <SortHeader label="ID" by="__id" sort={sort} onCycle={cycleSort} />
          {fields.map((f) => (
            <SortHeader key={f.name} label={f.name} by={f.name} sort={sort} onCycle={cycleSort} />
          ))}
        </div>

        <div className="relative" style={{ height: total * ROW_HEIGHT }}>
          {visible.map((f, vi) => {
            const i = winStart + vi
            const fid = String(f.id)
            const selected = selectedSet.has(fid)
            const isEditingRow = editing !== null && editing.featureId === fid
            return (
              <div
                key={i}
                onClick={() => toggleRow(fid)}
                className={cn(
                  'absolute inset-x-0 grid cursor-pointer items-center border-b border-border/40 text-xs',
                  selected
                    ? 'bg-accent-soft'
                    : i % 2 === 1
                      ? 'bg-white/[0.02] hover:bg-panel-2'
                      : 'hover:bg-panel-2',
                  isEditingRow && 'ring-1 ring-inset ring-accent',
                )}
                style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT, gridTemplateColumns: colTemplate }}
              >
                <div className="flex min-w-0 items-center justify-center">
                  {geometryIcon(f.geometry)}
                </div>
                <div
                  className="min-w-0 truncate px-2 text-text-dim"
                  title={f.id === undefined || f.id === null ? undefined : String(f.id)}
                >
                  {truncateId(f.id)}
                </div>
                {fields.map((field) => {
                  const raw = f.properties?.[field.name]
                  const isEditingCell = isEditingRow && editing!.field === field.name
                  return (
                    <div
                      key={field.name}
                      className={cn('min-w-0 truncate px-2', isEditingCell && 'p-0')}
                      title={raw === null || raw === undefined ? undefined : stringifyValue(raw)}
                      onDoubleClick={
                        editable
                          ? (e) => {
                              e.stopPropagation()
                              setSelection(layerId, [fid])
                              startEdit(fid, field.name, raw)
                            }
                          : undefined
                      }
                    >
                      {isEditingCell ? (
                        <input
                          autoFocus
                          value={editing!.draft}
                          onChange={(e) =>
                            setEditing((ed) => (ed ? { ...ed, draft: e.target.value } : ed))
                          }
                          onKeyDown={onEditKeyDown}
                          onBlur={commitEdit}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => e.stopPropagation()}
                          className="h-full w-full bg-panel-3 px-1.5 text-xs text-text outline-none ring-1 ring-accent"
                        />
                      ) : raw === null || raw === undefined ? (
                        <span className="text-text-faint">∅</span>
                      ) : (
                        stringifyValue(raw)
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {total === 0 && (
          <div className="flex h-16 items-center justify-center text-xs text-text-faint">
            无匹配数据
          </div>
        )}
      </div>

      {/* 底部：可见范围 */}
      <div className="shrink-0 border-t border-border px-2 py-1 text-[11px] text-text-faint">
        {total === 0 ? '共 0 行' : `显示 ${visStart + 1}–${visEnd} / 共 ${total} 行`}
      </div>
    </div>
  )
}

function SortHeader({
  label,
  by,
  sort,
  onCycle,
}: {
  label: string
  by: string
  sort: SortState
  onCycle: (by: string) => void
}) {
  const active = sort?.by === by
  return (
    <button
      type="button"
      onClick={() => onCycle(by)}
      title={`按「${label}」排序`}
      className={cn(
        'flex min-w-0 items-center gap-1 px-2 py-1 text-left transition-colors',
        active ? 'text-text' : 'hover:bg-panel-3 hover:text-text',
      )}
    >
      <span className="truncate">{label}</span>
      {active &&
        sort &&
        (sort.dir === 'asc' ? (
          <ArrowUp size={11} className="shrink-0 text-accent" />
        ) : (
          <ArrowDown size={11} className="shrink-0 text-accent" />
        ))}
    </button>
  )
}
