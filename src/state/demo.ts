/**
 * demo 场景加载器：拉取 demo/data/ 下的数据文件 → 解析 → 自动符号化 →
 * 以新工程载入（不覆盖当前工程之外的任何东西——场景即工程）。
 * 样式由 core/style/legend.ts 按数据生成，演示"自动制图"链路。
 */
import type { Feature, FeatureCollection } from 'geojson'
import { useProjectStore } from './project'
import { useUiStore } from './ui'
import * as engineBridge from './engineBridge'
import { getDemoScenario, type DemoLayerDef, type DemoScenario } from '@/core/demo/scenarios'
import { autoStyleSpec } from '@/core/style/legend'
import { inferLayerMeta, uid, type VectorLayerModel } from '@/core/layers/model'
import { parseFiles as datasourceParse } from '@/core/datasource/service'
import { pushViewToEngine } from './persistence'
import { toWebMercator } from '@/core/geo/transform'

/** demo 数据文件的 URL 前缀（vite publicDir = demo/） */
const DATA_BASE = `${import.meta.env.BASE_URL}data/`

/** 防重入：同一场景并发载入只执行一次（React StrictMode 双调用/双击防护） */
const loading = new Set<string>()

async function fetchText(file: string): Promise<string> {
  const resp = await fetch(`${DATA_BASE}${file}`)
  if (!resp.ok) throw new Error(`下载 ${file} 失败（HTTP ${resp.status}）`)
  return resp.text()
}

/** 解析 demo 数据文件为 GeoJSON 要素 */
async function loadFeatures(def: DemoLayerDef): Promise<Feature[]> {
  if (def.file.toLowerCase().endsWith('.csv')) {
    // CSV 走数据源服务（Worker 解析 + 经纬度列自动识别）
    const text = await fetchText(def.file)
    const results = await datasourceParse([
      { name: def.file, buffer: new TextEncoder().encode(text).buffer as ArrayBuffer },
    ])
    const first = results[0]
    if (!first || first.kind !== 'vector') throw new Error(`解析 ${def.file} 失败`)
    return first.features
  }
  const fc = JSON.parse(await fetchText(def.file)) as FeatureCollection
  if (fc.type !== 'FeatureCollection') throw new Error(`${def.file} 不是 FeatureCollection`)
  return fc.features
}

function toLayer(def: DemoLayerDef, features: Feature[], index: number): VectorLayerModel {
  const { geometryType, fields } = inferLayerMeta(features)
  const style = def.style ?? autoStyleSpec(features, fields, { ...def.auto, geometryType })
  const layer: VectorLayerModel = {
    id: uid('lyr'),
    name: def.name,
    kind: 'vector',
    visible: true,
    opacity: def.opacity ?? 1,
    zIndex: index,
    geometryType,
    features,
    fields,
    style: def.label ? { ...style, label: def.label } : style,
    editable: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  return layer
}

/**
 * 载入一个 demo 场景：新建同名工程（替换当前工程内容），
 * 拉取数据、自动符号化、设置底图与视图。
 */
export async function loadDemoScenario(scenarioId: string): Promise<boolean> {
  const scenario = getDemoScenario(scenarioId)
  if (!scenario) return false
  if (loading.has(scenarioId)) return false
  loading.add(scenarioId)
  const ui = useUiStore.getState()
  ui.setBusy({ id: `demo-${scenarioId}`, label: `载入示例「${scenario.title}」…` })
  try {
    const store = useProjectStore.getState()
    store.newProject(`示例：${scenario.title}`)
    for (const [i, def] of scenario.layers.entries()) {
      const features = await loadFeatures(def)
      useProjectStore.getState().addLayer(toLayer(def, features, i))
    }
    useProjectStore.getState().setBasemap(scenario.basemap)
    // zustand 订阅同步执行，此时引擎已同步图层；直接推视图/缩放
    if (scenario.view) {
      useProjectStore.getState().setView({ center: toWebMercator(scenario.view.center), zoom: scenario.view.zoom })
      pushViewToEngine()
    } else {
      engineBridge.engineFitToLayer()
    }
    ui.flash(`已载入示例：${scenario.title}`, 'ok')
    return true
  } catch (e) {
    ui.flash(`示例载入失败：${e instanceof Error ? e.message : String(e)}`, 'error')
    return false
  } finally {
    loading.delete(scenarioId)
    useUiStore.getState().setBusy(null)
  }
}

export type { DemoScenario }
export { DEMO_SCENARIOS } from '@/core/demo/scenarios'
