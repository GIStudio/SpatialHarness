/**
 * 顶部工具栏：工程操作、撤销重做、工具组、视图操作。
 */
import { useRef, type ReactNode } from 'react'
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
} from 'lucide-react'
import { Button, IconButton } from './ui/primitives'
import { useUiStore, type Tool } from '@/state/ui'
import { useHistoryStore } from '@/state/history'
import { useProjectStore } from '@/state/project'
import { useSelectionStore } from '@/state/selection'
import { engineFitToLayer } from '@/state/engineBridge'
import { runSave, importFromFilePicker, importFromDirectory, connectProjectFolder } from '@/state/persistence'

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

      <div className="flex-1" />

      {/* 面板开关 */}
      <IconButton title="图层面板" icon={<Layers size={15} />} active={leftOpen} onClick={toggleLeft} />
      <IconButton title="属性/样式/分析面板" icon={<PanelRight size={15} />} active={rightOpen} onClick={toggleRight} />
    </div>
  )
}
