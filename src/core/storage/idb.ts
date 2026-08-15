/**
 * Dexie 封装的本地 IndexedDB 存储层。
 *
 * 数据库名 'spatial-harness'，两个表：
 * - projects(id, updatedAt)：工程快照，snapshot 直接存 ProjectFile
 *   （其中 raster 的 ArrayBuffer 可被 IndexedDB 结构化克隆，无需编码）。
 * - meta(key)：通用键值，用于存 FileSystemDirectoryHandle 等未知类型值。
 */
import Dexie, { type Table } from 'dexie'

export interface ProjectRecord {
  id: string
  name: string
  /** ProjectFile 快照（含 ArrayBuffer，可直接结构化克隆） */
  snapshot: unknown
  updatedAt: number
}

export interface MetaRecord {
  key: string
  value: unknown
}

class WebGisDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>
  meta!: Table<MetaRecord, string>

  constructor() {
    super('spatial-harness')
    this.version(1).stores({
      projects: 'id, updatedAt',
      meta: 'key',
    })
  }
}

export const db = new WebGisDatabase()

export async function saveProjectRecord(rec: ProjectRecord): Promise<boolean> {
  try {
    await db.projects.put(rec)
    return true
  } catch {
    return false
  }
}

export async function getProjectRecord(id: string): Promise<ProjectRecord | undefined> {
  try {
    return await db.projects.get(id)
  } catch {
    return undefined
  }
}

export async function listProjectRecords(): Promise<ProjectRecord[]> {
  try {
    return await db.projects.orderBy('updatedAt').toArray()
  } catch {
    return []
  }
}

export async function deleteProjectRecord(id: string): Promise<boolean> {
  try {
    await db.projects.delete(id)
    return true
  } catch {
    return false
  }
}

export async function setMeta(key: string, value: unknown): Promise<boolean> {
  try {
    await db.meta.put({ key, value })
    return true
  } catch {
    return false
  }
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  try {
    const rec = await db.meta.get(key)
    return rec?.value as T | undefined
  } catch {
    return undefined
  }
}
