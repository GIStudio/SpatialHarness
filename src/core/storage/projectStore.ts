/**
 * 工程快照序列化与双轨保存：
 * - IndexedDB：始终写入（saveProjectRecord，ArrayBuffer 直接存）。
 * - 磁盘（File System Access）：有目录句柄且权限 granted 时，
 *   额外写 project.webgis.json（raster 数据转 base64 { __bin }）与 assets/<layerId>.tif。
 *   磁盘失败不影响 idb 成功。
 */
import type { ViewState } from '@/core/engine/types'
import { isRasterLayer, type LayerModel } from '@/core/layers/model'
import * as fsAccess from './fsAccess'
import { deleteProjectRecord, listProjectRecords, saveProjectRecord } from './idb'

export interface ProjectFile {
  app: 'spatial-harness'
  version: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  view: ViewState | null
  crs: 'EPSG:3857'
  layerOrder: string[]
  layers: LayerModel[]
}

export interface SaveProjectResult {
  idb: boolean
  disk: boolean
  diskReason?: string
}

/** 磁盘序列化时二进制数据的标记对象 */
interface BinaryMarker {
  __bin: string
}

const BINARY_CHUNK = 0x8000

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  // 分块转换避免超大字符串导致调用栈溢出
  for (let i = 0; i < bytes.length; i += BINARY_CHUNK) {
    chunks.push(String.fromCharCode(...Array.from(bytes.subarray(i, i + BINARY_CHUNK))))
  }
  return btoa(chunks.join(''))
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

/** 序列化：raster source.data（ArrayBuffer）转为 { __bin: base64 }，vector 要素内联 */
export function serializeForDisk(snapshot: ProjectFile): string {
  return JSON.stringify(snapshot, (_key, value) => {
    if (value instanceof ArrayBuffer) {
      return { __bin: arrayBufferToBase64(value) }
    }
    return value
  })
}

/** 反序列化：{ __bin: base64 } 还原为 ArrayBuffer */
export function parseFromDisk(jsonText: string): ProjectFile {
  const parsed = JSON.parse(jsonText, (_key, value) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as BinaryMarker).__bin === 'string'
    ) {
      return base64ToArrayBuffer((value as BinaryMarker).__bin)
    }
    return value
  })
  return parsed as ProjectFile
}

export async function saveProject(snapshot: ProjectFile): Promise<SaveProjectResult> {
  let idbOk = false
  try {
    idbOk = await saveProjectRecord({
      id: snapshot.id,
      name: snapshot.name,
      snapshot,
      updatedAt: snapshot.updatedAt,
    })
  } catch {
    idbOk = false
  }

  const disk = await writeSnapshotToDisk(snapshot)
  return { idb: idbOk, disk: disk.ok, diskReason: disk.reason }
}

async function writeSnapshotToDisk(
  snapshot: ProjectFile,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const root = await fsAccess.restoreDirectory()
    if (!root) return { ok: false, reason: 'no-folder-handle' }

    const state = await root.queryPermission({ mode: 'readwrite' })
    if (state !== 'granted') return { ok: false, reason: `permission-${state}` }

    const jsonText = serializeForDisk(snapshot)
    const projectWritten = await fsAccess.writeProjectFile(jsonText)
    if (!projectWritten) return { ok: false, reason: 'write-project-file-failed' }

    for (const layer of snapshot.layers) {
      if (isRasterLayer(layer)) {
        const assetWritten = await fsAccess.writeAsset(`${layer.id}.tif`, layer.source.data)
        if (!assetWritten) return { ok: false, reason: `write-asset-failed-${layer.id}` }
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

/** 从 IndexedDB 读最新工程（按 updatedAt 降序取第一条） */
export async function loadLatest(): Promise<ProjectFile | null> {
  try {
    const records = await listProjectRecords()
    if (records.length === 0) return null
    records.sort((a, b) => b.updatedAt - a.updatedAt)
    const snapshot = records[0].snapshot
    if (snapshot === null || typeof snapshot !== 'object') return null
    const file = snapshot as ProjectFile
    return file.app === 'spatial-harness' ? file : null
  } catch {
    return null
  }
}

/** 从磁盘目录读取工程：project.webgis.json + assets/<layerId>.tif 还原 raster 数据 */
export async function loadFromDisk(): Promise<ProjectFile | null> {
  try {
    const raw = await fsAccess.readProjectFile()
    if (raw === null || raw === undefined) return null
    const snapshot = parseFromDisk(JSON.stringify(raw))
    for (const layer of snapshot.layers) {
      if (isRasterLayer(layer)) {
        const data = await fsAccess.readAsset(`${layer.id}.tif`)
        if (data !== null) {
          layer.source.data = data
        }
      }
    }
    return snapshot
  } catch {
    return null
  }
}

export async function listProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  const records = await listProjectRecords()
  return records.map((rec) => ({ id: rec.id, name: rec.name, updatedAt: rec.updatedAt }))
}

export async function deleteProject(id: string): Promise<void> {
  await deleteProjectRecord(id)
}
