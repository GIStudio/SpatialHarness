/**
 * 引擎无关的坐标换算工具（基于 proj4，避免 UI 层依赖具体引擎）。
 * 业务坐标：EPSG:4326；视图坐标：EPSG:3857。
 */
import proj4 from 'proj4'

export function toWebMercator(lonLat: [number, number]): [number, number] {
  const [x, y] = proj4('EPSG:4326', 'EPSG:3857', lonLat)
  return [x, y]
}

export function toLonLat(webMercator: [number, number]): [number, number] {
  const [x, y] = proj4('EPSG:3857', 'EPSG:4326', webMercator)
  return [x, y]
}

/** 坐标格式化（状态栏/工具提示） */
export function formatCoord(lon: number, lat: number, digits = 5): string {
  const ew = lon >= 0 ? 'E' : 'W'
  const ns = lat >= 0 ? 'N' : 'S'
  return `${ew} ${Math.abs(lon).toFixed(digits)}°, ${ns} ${Math.abs(lat).toFixed(digits)}°`
}

/** 视图级数与比例尺近似换算（3857，纬度 0） */
export function zoomToScale(zoom: number): number {
  return Math.round((156543.03392804097 * Math.cos(0)) / Math.pow(2, zoom))
}

export function scaleLabel(scale: number): string {
  if (scale >= 1000000) return `1:${(scale / 1000000).toFixed(1)}M`
  if (scale >= 1000) return `1:${Math.round(scale / 1000)}K`
  return `1:${Math.round(scale)}`
}
