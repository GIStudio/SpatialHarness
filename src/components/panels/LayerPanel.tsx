/**
 * 图层面板（QGIS 风格图层树）：
 * 导入/打开数据、拖拽排序、可见性切换、内联改名，
 * 选中图层详情（不透明度 / 元信息 / 缩放 / 移除 / 导出）。
 */
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  GripVertical,
  Eye,
  EyeOff,
  Download,
  ChevronRight,
  MapPin,
  Spline,
  Shapes,
  Grid3x3,
  FolderInput,
  Upload,
  Trash2,
  Maximize2,
  Layers as LayersIcon,
} from 'lucide-react'
import { Button, IconButton, EmptyState, Slider, Spinner, cn } from '../ui/primitives'
import { useProjectStore } from '@/state/project'
import { useSelectionStore } from '@/state/selection'
import { useUiStore } from '@/state/ui'
import { engineFitToLayer } from '@/state/engineBridge'
import { importBuffers, importFromDirectory } from '@/state/persistence'
import { exportVector } from '@/core/datasource/service'
import type { ExportFormat, ImportFile } from '@/core/datasource/types'
import { isVectorLayer } from '@/core/layers/model'
import type { LayerModel } from '@/core/layers/model'

const FILE_ACCEPT = '.geojson,.json,.shp,.dbf,.shx,.prj,.kml,.gpx,.tif,.tiff,.gtiff,.csv,.zip'

const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'geojson', label: 'GeoJSON (.geojson)' },
  { format: 'csv', label: 'CSV (.csv)' },
  { format: 'kml', label: 'KML (.kml)' },
]

function LayerPanel() {
  const layers = useProjectStore((s) => s.layers)
  const removeLayer = useProjectStore((s) => s.removeLayer)
  const moveLayer = useProjectStore((s) => s.moveLayer)
  const activeLayerId = useSelectionStore((s) => s.activeLayerId)
  const setActiveLayer = useSelectionStore((s) => s.setActiveLayer)
  const clearLayer = useSelectionStore((s) => s.clearLayer)
  const setRightTab = useUiStore((s) => s.setRightTab)
  const busy = useUiStore((s) => s.busy)

  const fileRef = useRef<HTMLInputElement>(null)
  const dragIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const ensureProject = () => {
    if (!useProjectStore.getState().projectId) {
      useProjectStore.getState().newProject('未命名工程')
    }
  }

  const onImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    ensureProject()
    const list: ImportFile[] = []
    for (const f of Array.from(files)) list.push({ name: f.name, buffer: await f.arrayBuffer() })
    await importBuffers(list, '解析数据…')
  }

  const onImportFolder = () => {
    ensureProject()
    void importFromDirectory()
  }

  const onDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    dragIdRef.current = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  /** 反序渲染下：悬停行（store 下标 idx）上半部 → 插到其上方（store idx），下半部 → 其下方（store idx-1） */
  const onDragOver = (e: DragEvent<HTMLLIElement>, id: string) => {
    const dragged = dragIdRef.current
    if (!dragged || dragged === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverId(id)
    const rect = e.currentTarget.getBoundingClientRect()
    const above = e.clientY < rect.top + rect.height / 2
    const idx = useProjectStore.getState().layers.findIndex((l) => l.id === id)
    if (idx >= 0) moveLayer(dragged, above ? idx : idx - 1)
  }

  const clearDrag = () => {
    dragIdRef.current = null
    setDragOverId(null)
  }

  const activeLayer = layers.find((l) => l.id === activeLayerId)

  return (
    <div className="panel flex h-full min-h-0 flex-col">
      <div className="panel-header shrink-0">
        <span className="flex-1 truncate">图层</span>
        {busy && (
          <span title={busy.label} className="flex items-center">
            <Spinner className="text-accent" />
          </span>
        )}
        <Button
          size="xs"
          variant="ghost"
          icon={<Upload size={13} />}
          title="导入文件"
          onClick={() => fileRef.current?.click()}
        />
        <Button size="xs" variant="ghost" icon={<FolderInput size={13} />} title="打开数据文件夹" onClick={onImportFolder} />
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept={FILE_ACCEPT}
        onChange={(e) => {
          void onImportFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {layers.length === 0 ? (
          <EmptyState
            icon={<LayersIcon size={28} />}
            title="还没有图层"
            hint="导入本地数据文件，或打开一个数据文件夹开始"
            action={
              <div className="flex w-40 flex-col gap-1.5">
                <Button size="sm" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>
                  导入文件
                </Button>
                <Button size="sm" icon={<FolderInput size={14} />} onClick={onImportFolder}>
                  打开数据文件夹
                </Button>
              </div>
            }
          />
        ) : (
          <ul
            className="flex flex-col gap-0.5"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              clearDrag()
            }}
            onDragEnd={clearDrag}
          >
            {[...layers].reverse().map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                active={activeLayerId === layer.id}
                dragOver={dragOverId === layer.id}
                onSelect={() => {
                  setActiveLayer(layer.id)
                  setRightTab('attributes')
                }}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
              />
            ))}
          </ul>
        )}
      </div>

      {activeLayer && (
        <LayerDetails
          layer={activeLayer}
          onRemove={() => {
            removeLayer(activeLayer.id)
            clearLayer(activeLayer.id)
            if (activeLayerId === activeLayer.id) setActiveLayer(null)
          }}
        />
      )}
    </div>
  )
}

function LayerRow({
  layer,
  active,
  dragOver,
  onSelect,
  onDragStart,
  onDragOver,
}: {
  layer: LayerModel
  active: boolean
  dragOver: boolean
  onSelect: () => void
  onDragStart: (e: DragEvent<HTMLLIElement>, id: string) => void
  onDragOver: (e: DragEvent<HTMLLIElement>, id: string) => void
}) {
  const updateLayer = useProjectStore((s) => s.updateLayer)
  const renameLayer = useProjectStore((s) => s.renameLayer)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const cancelRef = useRef(false)

  const startEdit = () => {
    setDraft(layer.name)
    cancelRef.current = false
    setEditing(true)
  }

  const commit = () => {
    if (cancelRef.current) {
      cancelRef.current = false
      setEditing(false)
      return
    }
    const name = draft.trim()
    if (name && name !== layer.name) renameLayer(layer.id, name)
    setEditing(false)
  }

  const badge = layerBadge(layer)

  return (
    <li
      draggable={!editing}
      onDragStart={(e) => onDragStart(e, layer.id)}
      onDragOver={(e) => onDragOver(e, layer.id)}
      className={cn(
        'flex items-center gap-1 rounded-md py-0.5 pl-0.5 pr-1',
        active ? 'bg-panel-2' : 'hover:bg-panel-2/60',
        dragOver && 'drag-over',
      )}
    >
      {/* 左侧 accent 竖条（激活态） */}
      <span className={cn('h-4 w-0.5 shrink-0 rounded-full', active ? 'bg-accent' : 'bg-transparent')} />
      <span className="shrink-0 cursor-grab text-text-faint hover:text-text" title="拖拽调整图层顺序">
        <GripVertical size={13} />
      </span>
      <button
        type="button"
        title={layer.visible ? '隐藏图层' : '显示图层'}
        onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-dim hover:bg-panel-3 hover:text-text"
      >
        {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
      </button>
      {editing ? (
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              cancelRef.current = true
              setEditing(false)
            }
          }}
          onBlur={commit}
          className="h-6 min-w-0 flex-1 rounded border border-accent bg-panel-2 px-1.5 text-xs text-text focus:outline-none"
        />
      ) : (
        <span
          title={layer.name}
          onClick={onSelect}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className="min-w-0 flex-1 cursor-pointer truncate text-xs text-text"
        >
          {layer.name}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-text-faint" title={badge.label}>
        {badge.icon}
        {badge.label}
      </span>
    </li>
  )
}

function LayerDetails({ layer, onRemove }: { layer: LayerModel; onRemove: () => void }) {
  const updateLayer = useProjectStore((s) => s.updateLayer)
  const flash = useUiStore((s) => s.flash)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const vector = isVectorLayer(layer) ? layer : null

  const doExport = async (format: ExportFormat) => {
    if (!vector) return
    setExportOpen(false)
    setExporting(true)
    try {
      const { blob, fileName } = await exportVector({
        features: vector.features,
        format,
        layerName: vector.name,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      flash(`已导出 ${fileName}`, 'ok')
    } catch (e) {
      flash(`导出失败: ${String(e)}`, 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="shrink-0 space-y-2 border-t border-border bg-panel-2 p-2">
      <div className="flex items-center gap-1">
        <ChevronRight size={13} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{layer.name}</span>
        <IconButton title="缩放至图层" icon={<Maximize2 size={13} />} onClick={() => engineFitToLayer(layer.id)} />
        <IconButton title="移除图层" icon={<Trash2 size={13} />} onClick={onRemove} />
        <div className="relative">
          <IconButton
            title={vector ? '导出图层' : '仅矢量图层可导出'}
            icon={<Download size={13} />}
            disabled={!vector || exporting}
            active={exportOpen}
            onClick={() => setExportOpen((o) => !o)}
          />
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
              <div className="absolute bottom-full right-0 z-50 mb-1 w-40 overflow-hidden rounded-md border border-border bg-panel-2 shadow-xl">
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.format}
                    type="button"
                    onClick={() => void doExport(f.format)}
                    className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-text-dim hover:bg-panel-3 hover:text-text"
                  >
                    <Download size={12} className="shrink-0 text-text-faint" />
                    <span className="flex-1 truncate">{f.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <Slider
        label="不透明度"
        value={Math.round(layer.opacity * 100)}
        onChange={(v) => updateLayer(layer.id, { opacity: v / 100 })}
      />

      <div className="text-[10px] leading-relaxed text-text-faint">
        <div className="truncate">{buildMeta(layer)}</div>
        <div className="truncate">源 {sourceLabel(layer)}</div>
      </div>
    </div>
  )
}

function layerBadge(layer: LayerModel): { icon: ReactNode; label: string } {
  if (!isVectorLayer(layer)) return { icon: <Grid3x3 size={11} />, label: '栅格' }
  switch (layer.geometryType) {
    case 'Point':
      return { icon: <MapPin size={11} />, label: '点' }
    case 'LineString':
      return { icon: <Spline size={11} />, label: '线' }
    case 'Polygon':
      return { icon: <Shapes size={11} />, label: '面' }
    case 'Mixed':
      return { icon: <LayersIcon size={11} />, label: '混合' }
    default:
      return { icon: <Shapes size={11} />, label: '—' }
  }
}

function buildMeta(layer: LayerModel): string {
  const parts = isVectorLayer(layer)
    ? [
        `格式 ${layer.format ?? 'geojson'}`,
        `坐标系 ${layer.sourceCrs ?? 'EPSG:4326'}`,
        `要素 ${layer.features.length}`,
      ]
    : [
        `格式 ${layer.format ?? 'geotiff'}`,
        `坐标系 ${layer.source.crs ?? 'EPSG:4326'}`,
        layer.source.bands ? `波段 ${layer.source.bands}` : '栅格',
      ]
  return parts.filter(Boolean).join(' · ')
}

function sourceLabel(layer: LayerModel): string {
  return layer.sourceFile?.relativePath ?? layer.sourceFile?.name ?? layer.name
}

export default LayerPanel
export { LayerPanel }
