/**
 * 顶部工具栏：工程操作、撤销重做、工具组、视图操作。
 */
import { useRef, useState, type ReactNode } from 'react'
import {
  FilePlus2,
  FolderOpen,
  FolderInput,
  Save,
  HardDrive,
  Upload,
  Undo2,
  Redo2,
  MousePointer2,
  Crosshair,
  MapPin,
  Spline,
  Shapes,
  PencilRuler,
  Maximize2,
  Scan,
  Layers,
  PanelRight,
  Sparkles,
  ImageDown,
  ListOrdered,
} from 'lucide-react'
import { Button, IconButton, Select } from './ui/primitives'
import { DemoGallery } from './DemoGallery'
import { ExportPngDialog } from './ExportPngDialog'
import { useUiStore, type Tool } from '@/state/ui'
import { useHistoryStore } from '@/state/history'
import { useProjectStore } from '@/state/project'
import { useSelectionStore } from '@/state/selection'
import { engineFitToLayer } from '@/state/engineBridge'
import { runSave, importFromFilePicker, importFromDirectory, connectProjectFolder } from '@/state/persistence'
import type { BasemapId } from '@/core/engine/types'

const TOOL_ITEMS: { tool: Tool; label: string; icon: ReactNode }[] = [
  { tool: 'pan', label: '浏览', icon: <MousePointer2 size={15} /> },
  { tool: 'identify', label: '识别', icon: <Crosshair size={15} /> },
  { tool: 'draw-point', label: '绘制点', icon: <MapPin size={15} /> },
  { tool: 'draw-line', label: '绘制线', icon: <Spline size={15} /> },
  { tool: 'draw-polygon', label: '绘制面', icon: <Shapes size={15} /> },
  { tool: 'modify', label: '编辑顶点', icon: <PencilRuler size={15} /> },
]

export function Toolbar({ onNewProject, onOpenProject }: { onNewProject: () => void; onOpenProject: () => void }) {
  const tool = useUiStore((s) => s.tool)
  const setTool = useUiStore((s) => s.setTool)
  const undoStack = useHistoryStore((s) => s.undoStack)
  const redoStack = useHistoryStore((s) => s.redoStack)
  const leftOpen = useUiStore((s) => s.leftOpen)
  const rightOpen = useUiStore((s) => s.rightOpen)
  const toggleLeft = useUiStore((s) => s.toggleLeft)
  const toggleRight = useUiStore((s) => s.toggleRight)
  const diskConnected = useProjectStore((s) => s.diskConnected)
  const diskWritable = useProjectStore((s) => s.diskWritable)
  const basemap = useProjectStore((s) => s.basemap)
  const projectId = useProjectStore((s) => s.projectId)
  const legendVisible = useUiStore((s) => s.legendVisible)
  const toggleLegend = useUiStore((s) => s.toggleLegend)
  const [showDemos, setShowDemos] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const ensureProject = () => {
    if (!useProjectStore.getState().projectId) {
      useProjectStore.getState().newProject('未命名工程')
    }
  }

  const onImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    ensureProject()
    await importFromFilePicker(files)
  }

  const onImportFolder = async () => {
    ensureProject()
    await importFromDirectory()
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
      {/* 工程 */}
      <Button size="sm" icon={<FilePlus2 size={14} />} title="新建工程" onClick={onNewProject}>
        新建
      </Button>
      <Button size="sm" icon={<FolderOpen size={14} />} title="打开工程" onClick={onOpenProject}>
        打开
      </Button>
      <Button
        size="sm"
        icon={<Save size={14} />}
        title="立即保存（自动保存已开启）"
        onClick={() => void runSave()}
      >
        保存
      </Button>
      {diskConnected && diskWritable ? (
        <Button size="sm" icon={<HardDrive size={14} className="text-ok" />} title="已连接到本地文件夹" onClick={() => void connectProjectFolder()}>
          磁盘
        </Button>
      ) : (
        <Button size="sm" icon={<HardDrive size={14} />} title="选择本地文件夹作为保存位置" onClick={() => void connectProjectFolder()}>
          存到本地
        </Button>
      )}

      <div className="mx-1 h-5 w-px bg-border" />

      {/* 导入 */}
      <Button size="sm" icon={<Upload size={14} />} title="导入数据文件（GeoJSON/Shapefile/KML/GPX/GeoTIFF/CSV）" onClick={() => fileRef.current?.click()}>
        导入文件
      </Button>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        accept=".geojson,.json,.shp,.dbf,.shx,.prj,.kml,.gpx,.tif,.tiff,.gtiff,.csv,.zip"
        onChange={(e) => {
          void onImportFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <Button size="sm" icon={<FolderInput size={14} />} title="打开本地数据文件夹（File System Access API，直接读写磁盘）" onClick={() => void onImportFolder()}>
        打开数据文件夹
      </Button>
      <Button size="sm" icon={<Sparkles size={14} />} title="载入标准 demo 场景（开源数据 + 自动符号化 + 底图）" onClick={() => setShowDemos(true)}>
        示例
      </Button>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* 撤销重做 */}
      <IconButton
        title="撤销 (⌘Z)"
        icon={<Undo2 size={15} />}
        disabled={undoStack.length === 0}
        onClick={() => useHistoryStore.getState().undo()}
      />
      <IconButton
        title="重做 (⌘⇧Z)"
        icon={<Redo2 size={15} />}
        disabled={redoStack.length === 0}
        onClick={() => useHistoryStore.getState().redo()}
      />

      <div className="mx-1 h-5 w-px bg-border" />

      {/* 工具组 */}
      <div className="flex items-center rounded-md border border-border bg-panel-2 p-0.5">
        {TOOL_ITEMS.map((item) => (
          <button
            key={item.tool}
            type="button"
            title={item.label}
            onClick={() => setTool(tool === item.tool ? 'pan' : item.tool)}
            className={
              'flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors ' +
              (tool === item.tool
                ? 'bg-accent text-white'
                : 'text-text-dim hover:bg-panel-3 hover:text-text')
            }
          >
            {item.icon}
            <span className="hidden xl:inline">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* 视图 */}
      <IconButton title="缩放至选中图层" icon={<Maximize2 size={15} />} onClick={() => engineFitToLayer(useSelectionStore.getState().activeLayerId ?? undefined)} />
      <IconButton title="缩放至全部图层" icon={<Scan size={15} />} onClick={() => engineFitToLayer()} />

      <div className="mx-1 h-5 w-px bg-border" />

      {/* 底图与制图 */}
      <Select
        value={basemap}
        onChange={(v) => useProjectStore.getState().setBasemap(v as BasemapId)}
        options={[
          { value: 'none', label: '无底图' },
          { value: 'osm', label: '底图：OpenStreetMap' },
          { value: 'carto-light', label: '底图：Carto 浅色' },
          { value: 'carto-dark', label: '底图：Carto 深色' },
        ]}
      />
      <IconButton title="图例浮层" icon={<ListOrdered size={15} />} active={legendVisible} onClick={toggleLegend} />
      <Button
        size="sm"
        icon={<ImageDown size={14} />}
        title="导出当前视图为 PNG（含图题/图例/版权）"
        disabled={!projectId}
        onClick={() => setShowExport(true)}
      >
        导出 PNG
      </Button>

      <div className="flex-1" />

      {/* 面板开关 */}
      <IconButton title="图层面板" icon={<Layers size={15} />} active={leftOpen} onClick={toggleLeft} />
      <IconButton title="属性/样式/分析面板" icon={<PanelRight size={15} />} active={rightOpen} onClick={toggleRight} />

      {showDemos && <DemoGallery onClose={() => setShowDemos(false)} />}
      {showExport && <ExportPngDialog onClose={() => setShowExport(false)} />}
    </div>
  )
}
