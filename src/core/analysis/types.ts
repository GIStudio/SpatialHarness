/**
 * 空间分析协议：分析算子定义与 Worker 通信契约。
 * 计算全部在 Web Worker 中执行（计算下发到本地线程），主线程保持流畅。
 */
import type { Feature } from 'geojson'
import type { FieldInfo } from '@/core/layers/model'

export type BufferUnit = 'meters' | 'kilometers' | 'miles'

export type AnalysisOp =
  | { op: 'buffer'; layerId: string; distance: number; unit: BufferUnit; dissolve?: boolean }
  | { op: 'intersect'; layerA: string; layerB: string }
  | { op: 'union'; layerA: string; layerB: string }
  | { op: 'difference'; layerA: string; layerB: string }
  | { op: 'clip'; layerId: string; clipLayerId: string }
  | { op: 'dissolve'; layerId: string; field?: string }
  | { op: 'centroid'; layerId: string }
  | { op: 'fieldStats'; layerId: string; field: string }
  | { op: 'layerStats'; layerId: string }
  | { op: 'bbox'; layerId: string }

/** 算子的中文名（UI 展示） */
export const OP_LABELS: Record<AnalysisOp['op'], string> = {
  buffer: '缓冲区',
  intersect: '相交',
  union: '联合',
  difference: '差集',
  clip: '裁剪',
  dissolve: '融合',
  centroid: '质心',
  fieldStats: '字段统计',
  layerStats: '图层统计',
  bbox: '最小外接矩形',
}

export interface AnalysisJob {
  id: string
  op: AnalysisOp
  createdAt: number
}

export interface AnalysisTableResult {
  columns: string[]
  rows: (string | number | null)[][]
}

export type AnalysisOutcome =
  | { ok: true; kind: 'vector'; name: string; features: Feature[]; fields: FieldInfo[]; sourceCrs?: string }
  | { ok: true; kind: 'table'; name: string; table: AnalysisTableResult }
  | { ok: false; error: string }

/** Worker 暴露的 API（comlink 协议）：layers 传入参与分析的要素集合 */
export interface AnalysisWorkerApi {
  runAnalysis(op: AnalysisOp, layers: Record<string, Feature[]>): Promise<AnalysisOutcome>
}

/** 结果图层命名 */
export function resultLayerName(op: AnalysisOp, layerNames: Record<string, string>): string {
  const name = (id: string) => layerNames[id] ?? id
  switch (op.op) {
    case 'buffer':
      return `缓冲区_${name(op.layerId)}_${op.distance}${op.unit === 'meters' ? 'm' : op.unit === 'kilometers' ? 'km' : 'mi'}`
    case 'intersect':
      return `相交_${name(op.layerA)}_×_${name(op.layerB)}`
    case 'union':
      return `联合_${name(op.layerA)}_∪_${name(op.layerB)}`
    case 'difference':
      return `差集_${name(op.layerA)}_-_${name(op.layerB)}`
    case 'clip':
      return `裁剪_${name(op.layerId)}`
    case 'dissolve':
      return `融合_${name(op.layerId)}${op.field ? `_按${op.field}` : ''}`
    case 'centroid':
      return `质心_${name(op.layerId)}`
    case 'fieldStats':
      return `统计_${name(op.layerId)}_${op.field}`
    case 'layerStats':
      return `统计_${name(op.layerId)}`
    case 'bbox':
      return `外接矩形_${name(op.layerId)}`
  }
}
