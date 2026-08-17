/**
 * 栅格图层构建：RasterLayerSpec → ol 图层。
 * - geotiff：GeoTIFF DataTile source（多波段原生渲染）
 * - image：整图 PNG + 4326 bbox → ImageStatic（GeoPackage 瓦片表组装结果等）
 */
import TileLayer from 'ol/layer/Tile'
import ImageLayer from 'ol/layer/Image'
import GeoTIFF from 'ol/source/GeoTIFF.js'
import ImageStatic from 'ol/source/ImageStatic.js'
import { transformExtent } from 'ol/proj'
import type GeoTIFFSource from 'ol/source/GeoTIFF.js'
import type { RasterLayerSpec } from '../types'

export function buildRasterLayer(spec: RasterLayerSpec): TileLayer<GeoTIFFSource> | ImageLayer<ImageStatic> {
  if (spec.source.kind === 'image' && spec.source.bbox) {
    const url = URL.createObjectURL(new Blob([spec.source.data], { type: 'image/png' }))
    // bbox 为 4326；extent 统一转到 3857（与矢量图层一致，fitExtent 直接使用）
    const extent3857 = transformExtent(spec.source.bbox, 'EPSG:4326', 'EPSG:3857')
    const source = new ImageStatic({
      url,
      projection: 'EPSG:3857',
      imageExtent: extent3857,
    })
    const layer = new ImageLayer<ImageStatic>({
      source,
      opacity: spec.opacity ?? 1,
      visible: spec.visible ?? true,
      zIndex: spec.zIndex ?? 0,
    })
    layer.set('__layerId', spec.id)
    return layer
  }

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
