/**
 * Python 桥：连接本地运行的 `spatialharness serve`（pip 包 spatialharness ≥ 0.2.0）。
 *
 * 端点（详见 python 包 src/spatialharness/serve.py）：
 *   GET  /health          → {"ok": true, "version": "0.2.0"}
 *   GET  /plugins         → { [name]: { name, version, category, description,
 *                                       input_contract, output_contract, ... } }
 *   POST /run/<plugin>    → {"ok": true, "result": <JSON>}
 *
 * 数据约定：输入 data 为 GeoJSON FeatureCollection（wire 层自动转 DataFrame）；
 * 输出中 format === 'geojson' 的对象即 FeatureCollection（GeoDataFrame 序列化），
 * format === 'records' 为行式表格。
 */
import type { Feature } from 'geojson'
import type { AnalysisTableResult } from '@/core/analysis/types'

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765'

export interface PythonPluginInfo {
  name: string
  version: string
  category: string
  description: string
  author?: string
  input_contract: Record<string, string>
  output_contract: Record<string, string>
}

export interface BridgeStatus {
  ok: boolean
  version?: string
}

async function fetchJson(url: string, timeoutMs: number, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal })
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`
      try {
        const body = (await resp.json()) as { error?: string }
        if (body?.error) detail = body.error
      } catch {
        /* 非 JSON 错误体，保留状态码信息 */
      }
      throw new Error(detail)
    }
    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 探测本地桥是否在线；离线/异常一律返回 {ok:false}（不抛错，供 UI 静默降级） */
export async function checkBridge(baseUrl = DEFAULT_BRIDGE_URL, timeoutMs = 1500): Promise<BridgeStatus> {
  try {
    const body = (await fetchJson(`${baseUrl}/health`, timeoutMs)) as { ok?: boolean; version?: string }
    return body?.ok ? { ok: true, version: body.version } : { ok: false }
  } catch {
    return { ok: false }
  }
}

export async function listPlugins(baseUrl = DEFAULT_BRIDGE_URL): Promise<Record<string, PythonPluginInfo>> {
  const body = (await fetchJson(`${baseUrl}/plugins`, 3000)) as Record<string, PythonPluginInfo>
  return body ?? {}
}

/** 运行插件；data 传 GeoJSON FeatureCollection 或任意 JSON，params 为插件参数 */
export async function runPythonPlugin(
  name: string,
  data: unknown,
  params: Record<string, unknown>,
  baseUrl = DEFAULT_BRIDGE_URL,
  timeoutMs = 120_000,
): Promise<unknown> {
  const body = (await fetchJson(`${baseUrl}/run/${encodeURIComponent(name)}`, timeoutMs, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, params }),
  })) as { ok?: boolean; result?: unknown; error?: string }
  if (!body?.ok) throw new Error(body?.error ?? '未知错误')
  return body.result
}

// ---------------------------------------------------------------------------
// 结果解析：从插件返回 JSON 中提取 GeoJSON 要素 / 行式表格
// ---------------------------------------------------------------------------

interface GeoJsonPayload {
  type?: string
  format?: string
  features?: Feature[]
}

interface RecordsPayload {
  format?: string
  columns?: string[]
  rows?: (string | number | null)[][]
}

function scanResult<T>(result: unknown, test: (v: unknown) => T | null): T | null {
  if (result == null || typeof result !== 'object') return null
  const direct = test(result)
  if (direct != null) return direct
  if (!Array.isArray(result)) {
    for (const v of Object.values(result as Record<string, unknown>)) {
      const found = scanResult(v, test)
      if (found != null) return found
    }
  }
  return null
}

/** 提取 GeoJSON FeatureCollection（顶层或结果对象的任意值域，首个命中） */
export function extractGeoJsonFeatures(result: unknown): Feature[] | null {
  return scanResult(result, (v) => {
    const g = v as GeoJsonPayload
    if (g?.type === 'FeatureCollection' && Array.isArray(g.features) && g.features.length > 0) return g.features
    return null
  })
}

/** 提取行式表格（Python wire 层 {"format":"records","columns":[...],"rows":[[...]]}） */
export function extractTable(result: unknown): AnalysisTableResult | null {
  return scanResult(result, (v) => {
    const r = v as RecordsPayload
    if (r?.format === 'records' && Array.isArray(r.columns) && Array.isArray(r.rows)) {
      return { columns: r.columns.map(String), rows: r.rows }
    }
    return null
  })
}

/** 契约一行提示："输入: data=table · 输出: accessibility=table" */
export function contractHint(info: PythonPluginInfo): string {
  const fmt = (c: Record<string, string>) =>
    Object.entries(c).length ? Object.entries(c).map(([k, v]) => `${k}=${v}`).join(', ') : '无'
  return `输入: ${fmt(info.input_contract)} · 输出: ${fmt(info.output_contract)}`
}
