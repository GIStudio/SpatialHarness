/**
 * 持久化与启动恢复：自动保存（双轨：IndexedDB + 本地磁盘）、
 * 数据导入服务、磁盘工程打开。
 */
import { useProjectStore } from './project'
import { useUiStore } from './ui'
import * as engineBridge from './engineBridge'
import * as fsAccess from '@/core/storage/fsAccess'
import { saveProject, loadLatest, parseFromDisk, type ProjectFile } from '@/core/storage/projectStore'
import { parseFiles as datasourceParse } from '@/core/datasource/service'
import type { ImportFile } from '@/core/datasource/types'
import { uid, inferLayerMeta } from '@/core/layers/model'
import type { LayerModel, VectorLayerModel, RasterLayerModel } from '@/core/layers/model'
import { DEFAULT_PALETTE } from '@/core/style/types'

export function buildSnapshot(): ProjectFile {
  const s = useProjectStore.getState()
  return {
    app: 'spatial-harness',
    version: 1,
    id: s.projectId ?? 'unknown',
    name: s.projectName,
    createdAt: s.createdAt,
    updatedAt: Date.now(),
    view: s.view,
    crs: 'EPSG:3857',
    layerOrder: s.layers.map((l) => l.id),
    layers: s.layers,
  }
}

// ---------------- 自动保存 ----------------

let saveTimer: ReturnType<typeof setTimeout> | null = null

export function startAutosave(): void {
  // 任何状态变更只要 dirty 就重置防抖计时器：最后一次变更后 1.2s 保存。
  // 注意不能用 dirty 的 false→true 边沿：视图变化（setView）也会置 dirty，
  // 首次变更可能发生在订阅建立前，导致边沿永远不出现。
  useProjectStore.subscribe((state) => {
    if (state.dirty) scheduleSave()
  })
}

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void runSave(), 1200)
}

export async function runSave(): Promise<void> {
  const s = useProjectStore.getState()
  if (!s.projectId || !s.dirty) return
  s.setSaveStatus('saving')
  try {
    const report = await saveProject(buildSnapshot())
    useProjectStore.getState().setSaveStatus(report.disk ? 'disk' : report.idb ? 'idb-only' : 'error')
    useProjectStore.getState().setLastSavedAt(Date.now())
    useProjectStore.getState().setDirty(false)
  } catch {
    useProjectStore.getState().setSaveStatus('error')
  }
}

// ---------------- 导入服务 ----------------

const SUPPORTED_EXTS = new Set(['.geojson', '.json', '.shp', '.dbf', '.shx', '.prj', '.kml', '.gpx', '.tif', '.tiff', '.gtiff', '.csv', '.zip'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

function defaultStyle(geometryType: VectorLayerModel['geometryType']): VectorLayerModel['style'] {
  const color = DEFAULT_PALETTE[0]
  switch (geometryType) {
    case 'Point':
      return { symbol: { kind: 'simple', pointRadius: 6, pointColor: color }, label: null }
    case 'LineString':
      return { symbol: { kind: 'simple', strokeColor: color, strokeWidth: 2 }, label: null }
    case 'Polygon':
      return {
        symbol: { kind: 'simple', fillColor: 'rgba(230,25,75,0.3)', strokeColor: color, strokeWidth: 1.5 },
        label: null,
      }
    default:
      return { symbol: { kind: 'simple', pointRadius: 6, pointColor: color }, label: null }
  }
}

function toLayerModel(parsed: Awaited<ReturnType<typeof datasourceParse>>[number], index: number, files?: { name: string; relativePath?: string }[]): LayerModel {
  if (parsed.kind === 'vector') {
    const { geometryType, fields } = inferLayerMeta(parsed.features)
    const srcFile = files?.find((f) => f.name === `${parsed.name}.${parsed.format === 'shp' ? 'shp' : parsed.format}`)
    const layer: VectorLayerModel = {
      id: uid('lyr'),
      name: parsed.name,
      kind: 'vector',
      visible: true,
      opacity: 1,
      zIndex: index,
      geometryType,
      features: parsed.features,
      fields: parsed.fields.length ? parsed.fields : fields,
      style: defaultStyle(geometryType),
      sourceCrs: parsed.sourceCrs,
      sourceFile: srcFile
        ? { name: srcFile.name, relativePath: srcFile.relativePath, inProjectDir: !!srcFile.relativePath }
        : undefined,
      format: parsed.format as VectorLayerModel['format'],
      editable: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return layer
  }
  const layer: RasterLayerModel = {
    id: uid('lyr'),
    name: parsed.name,
    kind: 'raster',
    visible: true,
    opacity: 1,
    zIndex: index,
    source: { kind: 'geotiff', data: parsed.data, crs: parsed.crs, width: parsed.width, height: parsed.height, bands: parsed.bands },
    format: 'geotiff',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  return layer
}

export async function importBuffers(files: ImportFile[], label: string): Promise<number> {
  const ui = useUiStore.getState()
  ui.setBusy({ id: `import-${Date.now()}`, label })
  try {
    const results = await datasourceParse(files)
    const store = useProjectStore.getState()
    const base = store.layers.length
    const addedIds: string[] = []
    for (const [i, r] of results.entries()) {
      const layer = toLayerModel(r, base + i)
      store.addLayer(layer)
      addedIds.push(layer.id)
    }
    if (addedIds.length > 0) {
      engineBridge.engineFitToLayer(addedIds[0])
    }
    ui.flash(`已导入 ${addedIds.length} 个图层`, 'ok')
    return addedIds.length
  } catch (e) {
    ui.flash(`导入失败: ${String(e)}`, 'error')
    return 0
  } finally {
    useUiStore.getState().setBusy(null)
  }
}

/** 从文件选择器导入 */
export async function importFromFilePicker(fileList: FileList): Promise<void> {
  const files: ImportFile[] = []
  for (const f of Array.from(fileList)) {
    files.push({ name: f.name, buffer: await f.arrayBuffer() })
  }
  await importBuffers(files, '解析数据…')
}

/** 打开本地数据文件夹并导入（File System Access API） */
export async function importFromDirectory(): Promise<void> {
  if (!fsAccess.supported()) {
    useUiStore.getState().flash('当前浏览器不支持 File System Access API，请使用 Chrome/Edge', 'error')
    return
  }
  const handle = await fsAccess.openDirectory()
  if (!handle) return
  useProjectStore.getState().setDiskState(true, true)
  const ui = useUiStore.getState()
  ui.setBusy({ id: 'scan', label: '扫描文件夹…' })
  try {
    const files = await fsAccess.listFiles()
    const supported = files.filter((f) => SUPPORTED_EXTS.has(extOf(f.name)))
    if (supported.length === 0) {
      ui.flash('文件夹中没有找到支持的数据文件', 'warn')
      return
    }
    const buffers: ImportFile[] = []
    for (const f of supported) {
      const buf = await fsAccess.readAsset(f.relativePath)
      if (buf) buffers.push({ name: f.relativePath, buffer: buf })
    }
    await importBuffers(buffers, `解析 ${buffers.length} 个文件…`)
  } catch (e) {
    ui.flash(`读取文件夹失败: ${String(e)}`, 'error')
  } finally {
    useUiStore.getState().setBusy(null)
  }
}

/** 连接到本地文件夹（工程保存位置），随后立即保存一次 */
export async function connectProjectFolder(): Promise<boolean> {
  if (!fsAccess.supported()) {
    useUiStore.getState().flash('当前浏览器不支持 File System Access API，请使用 Chrome/Edge', 'error')
    return false
  }
  const handle = await fsAccess.openDirectory()
  if (!handle) return false
  useProjectStore.getState().setDiskState(true, true)
  await runSave()
  useUiStore.getState().flash('已连接到本地文件夹', 'ok')
  return true
}

/** 从磁盘打开工程（用户选择文件夹） */
export async function openProjectFromDisk(): Promise<boolean> {
  if (!fsAccess.supported()) {
    useUiStore.getState().flash('当前浏览器不支持 File System Access API，请使用 Chrome/Edge', 'error')
    return false
  }
  const handle = await fsAccess.openDirectory()
  if (!handle) return false
  const json = await fsAccess.readProjectFile()
  if (!json) {
    useUiStore.getState().flash('该文件夹中没有 project.webgis.json 工程文件', 'warn')
    return false
  }
  const snap = parseFromDisk(JSON.stringify(json))
  useProjectStore.getState().restoreFromSnapshot(snap)
  useProjectStore.getState().setDiskState(true, true)
  useUiStore.getState().setDiskProjectAvailable(false)
  useUiStore.getState().flash(`已打开磁盘工程：${snap.name}`, 'ok')
  pushViewToEngine()
  return true
}

/** 从浏览器内工程列表打开（按 id） */
export async function openProjectById(id: string): Promise<boolean> {
  const { getProjectRecord } = await import('@/core/storage/idb')
  const rec = await getProjectRecord(id)
  if (!rec) return false
  useProjectStore.getState().restoreFromSnapshot(rec.snapshot as ProjectFile)
  useUiStore.getState().flash(`已打开工程：${rec.name}`, 'ok')
  pushViewToEngine()
  return true
}

/** 恢复后把存储的视图推给引擎（引擎挂载早于工程恢复） */
export function pushViewToEngine(): void {
  const { getEngine } = engineBridge
  const view = useProjectStore.getState().view
  if (view) getEngine()?.setView(view)
}

/** 应用启动流程 */
export async function bootApp(): Promise<void> {
  let restored = false
  try {
    const snap = await loadLatest()
    if (snap) {
      useProjectStore.getState().restoreFromSnapshot(snap)
      restored = true
      pushViewToEngine()
    }
  } catch {
    // 忽略恢复错误，从空工程启动
  }
  try {
    const handle = await fsAccess.restoreDirectory()
    if (handle) {
      let perm: PermissionState = 'prompt'
      try {
        perm = await fsAccess.requestDirectoryPermission()
      } catch {
        perm = 'prompt'
      }
      useProjectStore.getState().setDiskState(true, perm === 'granted')
    }
  } catch {
    // 无文件夹句柄
  }
  if (!restored) {
    try {
      const disk = await fsAccess.readProjectFile()
      if (disk) useUiStore.getState().setDiskProjectAvailable(true)
    } catch {
      // 忽略
    }
  }
  useUiStore.getState().setBooted(true)
}
