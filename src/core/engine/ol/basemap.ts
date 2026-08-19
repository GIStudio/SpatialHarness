/**
 * 在线底图注册表（OpenLayers 适配层）。
 * 全部使用支持 CORS 的瓦片服务并设置 crossOrigin: 'anonymous'，
 * 保证导出 PNG 时画布不被污染（tainted canvas）。
 */
import TileLayer from 'ol/layer/Tile'
import XYZ from 'ol/source/XYZ'
import type { BasemapId } from '../types'

export interface BasemapEntry {
  id: Exclude<BasemapId, 'none'>
  name: string
  url: string
  attribution: string
  maxZoom: number
}

export const BASEMAPS: BasemapEntry[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  {
    id: 'carto-light',
    name: 'Carto 浅色',
    url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
  {
    id: 'carto-dark',
    name: 'Carto 深色',
    url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
  },
]

export function basemapEntry(id: BasemapId): BasemapEntry | null {
  if (id === 'none') return null
  return BASEMAPS.find((b) => b.id === id) ?? null
}

/** 创建底图图层；'none' 返回 null */
export function createBasemapLayer(id: BasemapId): TileLayer<XYZ> | null {
  const entry = basemapEntry(id)
  if (!entry) return null
  const layer = new TileLayer({
    source: new XYZ({
      url: entry.url,
      attributions: entry.attribution,
      maxZoom: entry.maxZoom,
      // 关键：允许跨域读取像素，PNG 导出依赖它
      crossOrigin: 'anonymous',
    }),
    zIndex: -1000,
  })
  layer.set('__basemap', true)
  return layer
}
