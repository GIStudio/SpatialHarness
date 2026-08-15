/**
 * 空间分析主线程封装：单例 Worker + Comlink 代理。
 * 结果图层命名（resultLayerName）由调用方在主线程完成，worker 不负责命名。
 */
import type { Feature } from 'geojson'
import * as Comlink from 'comlink'
import Worker from './worker?worker'
import type { AnalysisOp, AnalysisOutcome, AnalysisWorkerApi } from './types'

const inst = new Worker()

/** Comlink 代理：所有分析计算均下发到本地 Worker 线程 */
export const analysis = Comlink.wrap<AnalysisWorkerApi>(inst)

/** 便捷函数：下发一次空间分析任务 */
export function runAnalysis(op: AnalysisOp, layers: Record<string, Feature[]>): Promise<AnalysisOutcome> {
  return analysis.runAnalysis(op, layers)
}
