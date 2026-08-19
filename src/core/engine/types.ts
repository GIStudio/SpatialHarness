/**
 * 引擎无关的地图引擎抽象层。
 *
 * 这是本项目的核心设计：所有业务逻辑（图层模型、样式、分析、编辑、工程）
 * 只依赖本接口，不依赖任何具体引擎。OpenLayers 是 v1 实现，
 * 未来可通过 EngineRegistry 注册 MapLibre GL / Mapbox GL / Cesium 等新引擎。
 *
 * 约定：
 * - 坐标系：视图坐标系为 EPSG:3857（Web Mercator）；业务几何统一为 EPSG:4326，
 *   由引擎适配层负责两者之间的换算（OL 原生支持，其他引擎在适配层处理）。
 * - 所有返回/回调的要素坐标均为 EPSG:4326。
 */
import type { Feature, Geometry } from 'geojson'
import type { LayerStyle } from '@/core/style/types'
import type { LegendGroup } from '@/core/style/legend'

/** 在线底图（瓦片服务）标识；'none' 表示无底图（本地优先默认） */
export type BasemapId = 'none' | 'osm' | 'carto-light' | 'carto-dark'

/** PNG 导出：图例分块（按图层分组） */
export type ExportLegendGroup = LegendGroup

export interface ExportPngOptions {
  /** 图题（绘制在图像顶部） */
  title?: string
  /** 图例（绘制在图像右下角），空数组或不传则不绘制 */
  legends?: ExportLegendGroup[]
  /** 版权/来源说明（绘制在图像左下角） */
  attribution?: string
  /** 分辨率倍数（1 或 2，默认 1） */
  scale?: number
}

/** 引擎无关的要素视图（用于拾取/选中回调） */
export interface EngineFeature {
  id: string
  layerId: string
  properties: Record<string, unknown>
  geometry: Geometry | null
}

/** 视图状态（坐标为视图投影，即 EPSG:3857） */
export interface ViewState {
  center: [number, number]
  zoom: number
  rotation?: number
}

export type EngineEventMap = {
  /** 地图单击，返回命中的要素（已按图层顺序排序）；coordinate 为 EPSG:4326 */
  click: { coordinate: [number, number]; features: EngineFeature[] }
  /** 鼠标移动；coordinate 为 EPSG:4326 */
  pointermove: { coordinate: [number, number] }
  viewchange: ViewState
  selectionchange: { layerId: string; featureIds: string[] }
  /** 绘制完成（几何为 EPSG:4326） */
  drawend: { layerId: string; feature: Feature }
  /** 顶点编辑结束 */
  modifyend: { layerId: string; featureIds: string[] }
  /** 图层渲染完成（用于"加载中"状态） */
  rendercomplete: { layerId?: string }
}

export interface VectorLayerSpec {
  id: string
  name: string
  /** 几何为 EPSG:4326 */
  features: Feature[]
  style: LayerStyle
  visible?: boolean
  opacity?: number
  zIndex?: number
  /** 是否参与拾取 */
  interactive?: boolean
  editable?: boolean
}

export interface RasterSourceSpec {
  /** geotiff：GeoTIFF 字节流；image：已组装的整图（PNG）+ 4326 bbox（如 GeoPackage 瓦片表） */
  kind: 'geotiff' | 'image'
  /** 栅格二进制数据 */
  data: ArrayBuffer | Blob
  crs?: string
  /** kind='image' 时的 EPSG:4326 bbox [minLon, minLat, maxLon, maxLat] */
  bbox?: [number, number, number, number]
}

export interface RasterLayerSpec {
  id: string
  name: string
  source: RasterSourceSpec
  visible?: boolean
  opacity?: number
  zIndex?: number
}

export type DrawGeometryType = 'Point' | 'LineString' | 'Polygon'

export interface EngineCapabilities {
  draw: boolean
  modify: boolean
  raster: boolean
  selection: boolean
  /** 支持多少种拾取方式 */
  identify: boolean
}

export interface MapEngine {
  readonly id: string
  readonly displayName: string
  readonly capabilities: EngineCapabilities

  /** 挂载到容器 */
  mount(target: HTMLElement, options: { view: ViewState }): void
  destroy(): void

  // ---- 图层管理 ----
  addVectorLayer(spec: VectorLayerSpec): void
  addRasterLayer(spec: RasterLayerSpec): void
  removeLayer(id: string): void
  /** 整体替换图层矢量数据（几何 EPSG:4326） */
  updateVectorData(id: string, features: Feature[]): void
  /** 重绘图层（数据原地变化后调用，如顶点编辑） */
  refreshLayer(id: string): void
  /** 回读图层当前全部要素（几何 EPSG:4326；顶点编辑后取最新几何用） */
  getLayerFeatures(id: string): Feature[]
  updateLayerStyle(id: string, style: LayerStyle): void
  setLayerVisible(id: string, visible: boolean): void
  setLayerOpacity(id: string, opacity: number): void
  setLayerZIndex(id: string, zIndex: number): void
  getLayerIds(): string[]
  layerCount(): number

  // ---- 底图与导出 ----
  /** 切换在线底图（'none' 关闭） */
  setBasemap(id: BasemapId): void
  getBasemap(): BasemapId
  /** 导出当前视图为 PNG（合成画布 + 可选图题/图例/版权） */
  exportPng(options?: ExportPngOptions): Promise<Blob>

  // ---- 视图 ----
  getView(): ViewState
  setView(view: Partial<ViewState>, opts?: { animate?: boolean }): void
  /** 缩放到指定图层范围（省略则全图） */
  fitExtent(layerIds?: string[]): void

  // ---- 拾取与选择 ----
  /** 按像素坐标拾取要素（引擎内部做 3857→4326 换算），返回 EPSG:4326 要素 */
  identify(pixel: [number, number], opts?: { layerIds?: string[] }): Feature[]
  setSelection(layerId: string, featureIds: string[]): void
  clearSelection(): void

  // ---- 编辑 ----
  startDraw(type: DrawGeometryType, layerId: string, onEnd: (feature: Feature) => void): void
  cancelDraw(): void
  startModify(layerId: string): void
  stopModify(): void

  // ---- 事件 ----
  on<E extends keyof EngineEventMap>(event: E, handler: (payload: EngineEventMap[E]) => void): () => void
}

export type EngineFactory = () => MapEngine

/** 引擎注册表：框架通过它创建/切换引擎实例 */
export interface EngineRegistry {
  register(id: string, displayName: string, factory: EngineFactory): void
  create(id?: string): MapEngine | null
  available(): { id: string; displayName: string }[]
}
