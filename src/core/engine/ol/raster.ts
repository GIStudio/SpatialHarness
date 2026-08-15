/**
 * 栅格图层构建：RasterLayerSpec → ol TileLayer（GeoTIFF DataTile source）。
 */
import TileLayer from 'ol/layer/Tile'
import GeoTIFF from 'ol/source/GeoTIFF.js'
import type GeoTIFFSource from 'ol/source/GeoTIFF.js'
import type { RasterLayerSpec } from '../types'

export function buildRasterLayer(spec: RasterLayerSpec): TileLayer<GeoTIFFSource> {
  const source = new GeoTIFF({
    sources: [{ blob: new Blob([spec.source.data]) }],
  })
  const layer = new TileLayer<GeoTIFFSource>({
    source,
    opacity: spec.opacity ?? 1,
    visible: spec.visible ?? true,
    zIndex: spec.zIndex ?? 0,
  })
  layer.set('__layerId', spec.id)
  return layer
}
