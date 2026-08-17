/**
 * 数据源层协议：格式无关的导入/导出契约。
 * 解析在 Web Worker 中执行（计算下发），UI 只通过 service 调用。
 * 约定：返回的矢量几何已归一化为 EPSG:4326；原始坐标系记录在 sourceCrs。
 */
import type { Feature } from 'geojson'
import type { FieldInfo } from '@/core/layers/model'

export type SupportedFormat = 'geojson' | 'shp' | 'kml' | 'gpx' | 'geotiff' | 'csv' | 'gpkg'

export interface ImportFile {
  name: string
  buffer: ArrayBuffer
}

export interface ParsedVectorData {
  kind: 'vector'
  /** 图层名（不含扩展名） */
  name: string
  format: SupportedFormat
  features: Feature[]
  fields: FieldInfo[]
  /** 原始坐标系（如 EPSG:4490），几何已转换到 EPSG:4326 */
  sourceCrs?: string
  warnings: string[]
}

export interface ParsedRasterData {
  kind: 'raster'
  name: string
  /** geotiff：原始栅格；gpkg-tiles：GeoPackage 瓦片表组装的整图（PNG） */
  format: 'geotiff' | 'gpkg-tiles'
  data: ArrayBuffer
  width: number
  height: number
  bands: number
  crs?: string
  /** gpkg-tiles 组装整图的 EPSG:4326 bbox [minLon, minLat, maxLon, maxLat] */
  bbox?: [number, number, number, number]
  warnings: string[]
}

export type ParseResult = ParsedVectorData | ParsedRasterData

export type ExportFormat = 'geojson' | 'csv' | 'kml' | 'shp' | 'gpx' | 'gpkg'

export interface ExportRequest {
  features: Feature[]
  format: ExportFormat
  layerName: string
  /** CSV 时经纬度字段名 */
  lonField?: string
  latField?: string
}

export interface ExportResult {
  blob: Blob
  fileName: string
  /** 导出过程中的非致命警告（如混合几何被跳过、字段名改写） */
  warnings?: string[]
}

/** 栅格瓦片导出请求：PNG 整图 + EPSG:4326 bbox → GeoPackage 瓦片表 */
export interface GpkgTilesRequest {
  /** PNG 字节 */
  pngBytes: Uint8Array
  /** EPSG:4326 [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number]
  layerName: string
}

/** Worker 暴露的 API（comlink 协议） */
export interface DatasourceWorkerApi {
  parseFiles(files: ImportFile[]): Promise<ParseResult[]>
  exportVector(req: ExportRequest): Promise<ExportResult>
  exportGpkgTiles(req: GpkgTilesRequest): Promise<Uint8Array>
}

/** 工程目录内自动写入的数据文件布局（与 projectStore 约定一致） */
export const ASSET_DIR = 'assets'
