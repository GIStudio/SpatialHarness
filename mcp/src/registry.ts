/**
 * 会话级数据集注册表：MCP 服务器进程内存中保存已加载/已生成的数据集。
 * 每次 vector 分析结果也会自动注册，便于链式调用（buffer 的结果可直接用于 intersect）。
 */
import type { Feature } from 'geojson'
import type { FieldInfo, VectorGeometryType } from '@/core/layers/model'
import type { SupportedFormat } from '@/core/datasource/types'

export interface StoredDataset {
  id: string
  name: string
  format: SupportedFormat
  features: Feature[]
  fields: FieldInfo[]
  geometryType: VectorGeometryType
  sourceCrs?: string
  warnings: string[]
  createdAt: number
}

export class DatasetStore {
  private readonly map = new Map<string, StoredDataset>()
  private seq = 0

  add(input: Omit<StoredDataset, 'id' | 'createdAt'>): StoredDataset {
    const ds: StoredDataset = { ...input, id: `L${++this.seq}`, createdAt: Date.now() }
    this.map.set(ds.id, ds)
    return ds
  }

  get(id: string): StoredDataset | undefined {
    return this.map.get(id)
  }

  list(): StoredDataset[] {
    return [...this.map.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  remove(id: string): boolean {
    return this.map.delete(id)
  }

  get size(): number {
    return this.map.size
  }
}
