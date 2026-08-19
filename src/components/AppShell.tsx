/**
 * 应用外壳：布局 + 启动流程 + 欢迎页 + 工程对话框。
 */
import { useEffect, useState } from 'react'
import {
  FilePlus2,
  FolderOpen,
  FolderInput,
  Upload,
  HardDrive,
  MapPin,
  Database,
  CloudOff,
  Layers as LayersIcon,
  FlaskConical,
  Sparkles,
} from 'lucide-react'
import { Toolbar } from './Toolbar'
import { StatusBar } from './StatusBar'
import { MapView } from './MapView'
import { LayerPanel } from './panels/LayerPanel'
import { RightPanel } from './panels/RightPanel'
import { Button, Modal, TextInput } from './ui/primitives'
import { useProjectStore } from '@/state/project'
import { useUiStore } from '@/state/ui'
import {
  bootApp,
  startAutosave,
  importFromFilePicker,
  importFromDirectory,
  connectProjectFolder,
  openProjectFromDisk,
  openProjectById,
  pushViewToEngine,
} from '@/state/persistence'
import { loadDemoScenario } from '@/state/demo'
import { listProjects } from '@/core/storage/projectStore'
import { DemoGallery } from './DemoGallery'

/** 启动流程只执行一次（React StrictMode 双调用会导致恢复与示例加载竞态） */
let bootStarted = false

export function AppShell() {
  const [showNew, setShowNew] = useState(false)
  const [showOpen, setShowOpen] = useState(false)
  const booted = useUiStore((s) => s.booted)
  const projectId = useProjectStore((s) => s.projectId)
  const leftOpen = useUiStore((s) => s.leftOpen)
  const rightOpen = useUiStore((s) => s.rightOpen)

  useEffect(() => {
    if (bootStarted) return
    bootStarted = true
    startAutosave()
    void bootApp().then(() => {
      // URL 参数 ?demo=<场景id>：直接载入示例（演示/截图自动化用）
      const demoId = new URLSearchParams(window.location.search).get('demo')
      if (demoId) void loadDemoScenario(demoId)
    })
  }, [])

  return (
    <div className="relative flex h-full flex-col bg-bg">
      <Toolbar onNewProject={() => setShowNew(true)} onOpenProject={() => setShowOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {leftOpen && (
          <aside className="w-72 shrink-0 border-r border-border bg-panel p-1.5">
            <LayerPanel />
          </aside>
        )}
        <main className="relative min-w-0 flex-1">
          <MapView />
        </main>
        {rightOpen && (
          <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-panel p-1.5">
            <RightPanel />
          </aside>
        )}
      </div>

      <StatusBar />

      {/* 欢迎页（无工程时） */}
      {booted && !projectId && <Welcome onNew={() => setShowNew(true)} onOpen={() => setShowOpen(true)} />}

      {showNew && (
        <NewProjectDialog
          onClose={() => setShowNew(false)}
          onCreated={() => setShowNew(false)}
        />
      )}
      {showOpen && (
        <OpenProjectDialog
          onClose={() => setShowOpen(false)}
          onOpened={() => {
            setShowOpen(false)
            pushViewToEngine()
          }}
        />
      )}
    </div>
  )
}

function Welcome({ onNew, onOpen }: { onNew: () => void; onOpen: () => void }) {
  const flash = useUiStore((s) => s.flash)
  const diskProjectAvailable = useUiStore((s) => s.diskProjectAvailable)
  const [showDemos, setShowDemos] = useState(false)

  const ensureProject = () => {
    if (!useProjectStore.getState().projectId) {
      useProjectStore.getState().newProject('未命名工程')
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="panel w-[560px] max-w-[92vw] p-8 shadow-2xl">
        <div className="mb-1 flex items-center gap-2">
          <MapPin size={20} className="text-accent" />
          <h1 className="text-xl font-bold text-text">SpatialHarness</h1>
        </div>
        <p className="mb-6 text-sm text-text-dim">
          纯本地 WebGIS 工作台 · 数据全部保存在你的电脑上，不经过任何服务器
        </p>

        <div className="mb-6 grid grid-cols-3 gap-2 text-center">
          {[
            { icon: <Database size={16} className="mx-auto mb-1 text-accent" />, t: '数据本地化', d: '直读本地磁盘文件' },
            { icon: <FlaskConical size={16} className="mx-auto mb-1 text-ok" />, t: '计算下发', d: 'Web Worker 并行计算' },
            { icon: <CloudOff size={16} className="mx-auto mb-1 text-warn" />, t: '自动保存', d: '关闭浏览器不丢失' },
          ].map((f) => (
            <div key={f.t} className="rounded-md border border-border bg-panel-2 p-2.5">
              {f.icon}
              <div className="text-xs font-medium text-text">{f.t}</div>
              <div className="text-[11px] text-text-faint">{f.d}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button size="md" variant="primary" icon={<FilePlus2 size={15} />} onClick={onNew}>
            新建工程
          </Button>
          {diskProjectAvailable && (
            <Button size="md" variant="outline" icon={<FolderOpen size={15} />} onClick={() => void openProjectFromDisk()}>
              打开磁盘工程
            </Button>
          )}
          {!diskProjectAvailable && (
            <Button size="md" icon={<FolderOpen size={15} />} onClick={onOpen}>
              打开工程
            </Button>
          )}
          <Button
            size="md"
            icon={<Upload size={15} />}
            onClick={() => {
              ensureProject()
              const input = document.createElement('input')
              input.type = 'file'
              input.multiple = true
              input.accept = '.geojson,.json,.shp,.dbf,.shx,.prj,.kml,.gpx,.tif,.tiff,.gtiff,.csv,.zip'
              input.onchange = (e) => {
                const files = (e.target as HTMLInputElement).files
                if (files) void importFromFilePicker(files)
              }
              input.click()
            }}
          >
            导入数据文件
          </Button>
          <Button
            size="md"
            icon={<FolderInput size={15} />}
            onClick={() => {
              ensureProject()
              void importFromDirectory().catch(() => flash('读取文件夹失败', 'error'))
            }}
          >
            打开数据文件夹
          </Button>
          <Button size="md" variant="outline" icon={<Sparkles size={15} />} onClick={() => setShowDemos(true)}>
            打开示例库
          </Button>
        </div>
        <p className="mt-4 text-center text-[11px] text-text-faint">
          支持 GeoJSON / Shapefile / KML / GPX / GeoTIFF / CSV · 推荐使用 Chrome 或 Edge
        </p>
        {showDemos && <DemoGallery onClose={() => setShowDemos(false)} />}
      </div>
    </div>
  )
}

function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [folderConnected, setFolderConnected] = useState(false)
  const diskConnected = useProjectStore((s) => s.diskConnected)
  const flash = useUiStore((s) => s.flash)

  const create = () => {
    useProjectStore.getState().newProject(name.trim() || '未命名工程')
    if (diskConnected) void connectProjectFolder()
    flash('工程已创建，自动保存已开启', 'ok')
    onCreated()
  }

  return (
    <Modal
      title="新建工程"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={create}>
            创建
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-dim">工程名称</span>
          <TextInput value={name} onChange={setName} placeholder="例如：城市规划分析" autoFocus onKeyDown={(e) => e.key === 'Enter' && create()} />
        </div>
        <div className="flex items-center justify-between rounded-md border border-border bg-panel-2 p-3">
          <div>
            <div className="text-xs font-medium text-text">保存位置</div>
            <div className="mt-0.5 text-[11px] text-text-faint">
              {folderConnected ? '已连接本地文件夹，工程将自动写入磁盘' : '默认保存在浏览器工作区（关闭浏览器不丢失），可随时连接本地文件夹'}
            </div>
          </div>
          <Button
            size="sm"
            icon={<HardDrive size={14} />}
            variant={folderConnected ? 'primary' : 'default'}
            onClick={async () => {
              const ok = await connectProjectFolder()
              if (ok) setFolderConnected(true)
            }}
          >
            {folderConnected ? '已连接' : '选择文件夹'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function OpenProjectDialog({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: number }[]>([])
  const flash = useUiStore((s) => s.flash)

  useEffect(() => {
    void listProjects().then(setProjects)
  }, [])

  return (
    <Modal
      title="打开工程"
      onClose={onClose}
      footer={
        <Button
          variant="outline"
          icon={<FolderOpen size={14} />}
          onClick={async () => {
            const ok = await openProjectFromDisk()
            if (ok) {
              onOpened()
              flash('已从磁盘打开工程', 'ok')
            }
          }}
        >
          从磁盘打开…
        </Button>
      }
    >
      <div className="flex flex-col gap-1.5">
        {projects.length === 0 && (
          <div className="py-6 text-center text-xs text-text-faint">浏览器工作区中还没有工程</div>
        )}
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            className="flex items-center gap-2 rounded-md border border-border bg-panel-2 px-3 py-2 text-left hover:border-accent"
            onClick={async () => {
              const ok = await openProjectById(p.id)
              if (ok) {
                onOpened()
                flash(`已打开工程：${p.name}`, 'ok')
              }
            }}
          >
            <LayersIcon size={14} className="text-accent" />
            <span className="flex-1 truncate text-xs text-text">{p.name}</span>
            <span className="text-[11px] text-text-faint">
              {new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
