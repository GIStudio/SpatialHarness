/**
 * 空间分析 Web Worker：只做 comlink 协议暴露与算子分发，计算全部在 ops.ts 中。
 */
import * as Comlink from 'comlink'
import { runAnalysisOp } from './ops'
import type { AnalysisWorkerApi } from './types'

const api: AnalysisWorkerApi = {
  async runAnalysis(op, layers) {
    return runAnalysisOp(op, layers)
  },
}

Comlink.expose(api)
