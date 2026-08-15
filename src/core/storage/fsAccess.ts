/**
 * File System Access API 封装（仅 Chrome/Edge 支持）。
 *
 * 打开工程目录后把 FileSystemDirectoryHandle 存入 IndexedDB（句柄可结构化克隆），
 * 之后通过 restoreDirectory() 恢复。所有读写方法内部捕获异常并返回 null/false，
 * 不向外抛出。
 */
import { ASSET_DIR } from '@/core/datasource/types'
import { getMeta, setMeta } from './idb'

const FOLDER_HANDLE_KEY = 'folderHandle'
const PROJECT_FILE_NAME = 'project.webgis.json'

/**
 * TS DOM lib 落后于 File System Access API 规范，缺失以下成员，
 * 这里就地补充（shim），运行时不产生任何代码。
 */
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite'
  }

  interface DirectoryPickerOptions {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?:
      | FileSystemHandle
      | 'desktop'
      | 'documents'
      | 'downloads'
      | 'music'
      | 'pictures'
      | 'videos'
  }

  interface FileSystemHandle {
    queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
    requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>
  }

  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
  }
}

export function supported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export async function openDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!supported()) return null
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    await setMeta(FOLDER_HANDLE_KEY, handle)
    return handle
  } catch {
    return null
  }
}

export async function restoreDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await getMeta<FileSystemDirectoryHandle>(FOLDER_HANDLE_KEY)
    return handle ?? null
  } catch {
    return null
  }
}

export async function requestDirectoryPermission(): Promise<PermissionState> {
  try {
    const handle = await restoreDirectory()
    if (!handle) return 'prompt'
    return await handle.requestPermission({ mode: 'readwrite' })
  } catch {
    return 'prompt'
  }
}

export async function releaseDirectory(): Promise<void> {
  try {
    await setMeta(FOLDER_HANDLE_KEY, undefined)
  } catch {
    // 释放失败不影响后续流程
  }
}

export async function readProjectFile(): Promise<unknown | null> {
  try {
    const root = await restoreDirectory()
    if (!root) return null
    const fileHandle = await root.getFileHandle(PROJECT_FILE_NAME)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

export async function writeProjectFile(json: unknown): Promise<boolean> {
  try {
    const root = await restoreDirectory()
    if (!root) return false
    const fileHandle = await root.getFileHandle(PROJECT_FILE_NAME, { create: true })
    const writable = await fileHandle.createWritable()
    // 兼容传入已序列化字符串或任意可 JSON 序列化的对象
    const text = typeof json === 'string' ? json : JSON.stringify(json, null, 2)
    await writable.write(text)
    await writable.close()
    return true
  } catch {
    return false
  }
}

export async function writeAsset(relativePath: string, data: BlobPart): Promise<boolean> {
  try {
    const root = await restoreDirectory()
    if (!root) return false
    const segments = relativePath.split('/').filter((s) => s.length > 0)
    if (segments.length === 0) return false
    // 自动创建 assets 子目录（含嵌套路径）
    let dir = await root.getDirectoryHandle(ASSET_DIR, { create: true })
    for (let i = 0; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i], { create: true })
    }
    const fileName = segments[segments.length - 1]
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(data)
    await writable.close()
    return true
  } catch {
    return false
  }
}

export async function readAsset(relativePath: string): Promise<ArrayBuffer | null> {
  try {
    const root = await restoreDirectory()
    if (!root) return null
    const segments = relativePath.split('/').filter((s) => s.length > 0)
    if (segments.length === 0) return null
    let dir = await root.getDirectoryHandle(ASSET_DIR)
    for (let i = 0; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i])
    }
    const fileHandle = await dir.getFileHandle(segments[segments.length - 1])
    const file = await fileHandle.getFile()
    return await file.arrayBuffer()
  } catch {
    return null
  }
}

export interface FileEntry {
  name: string
  relativePath: string
  size: number
}

export async function listFiles(): Promise<FileEntry[]> {
  try {
    const root = await restoreDirectory()
    if (!root) return []
    const out: FileEntry[] = []
    await walkDirectory(root, '', out)
    return out
  } catch {
    return []
  }
}

async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: FileEntry[],
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      out.push({
        name: entry.name,
        relativePath: prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name,
        size: file.size,
      })
    } else {
      await walkDirectory(entry, prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name, out)
    }
  }
}
