/**
 * GeoTIFF 解析：读取尺寸/波段数/CRS 元信息，data 原样保留 buffer 供渲染层使用。
 */
import { fromArrayBuffer } from 'geotiff'
import type { ParsedRasterData } from '../types'

/** GeoKey 数值定义（GeoTIFF 规范） */
const PROJECTED_CS_TYPE = 3072
const GEOGRAPHIC_CS_TYPE = 2048

export async function parseGeoTiff(buffer: ArrayBuffer, name: string): Promise<ParsedRasterData> {
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()

  const geoKeys = image.geoKeys as Record<number, number> | undefined
  const code = geoKeys?.[PROJECTED_CS_TYPE] ?? geoKeys?.[GEOGRAPHIC_CS_TYPE]
  const crs = code ? `EPSG:${code}` : undefined

  return {
    kind: 'raster',
    name,
    format: 'geotiff',
    data: buffer,
    width: image.getWidth(),
    height: image.getHeight(),
    bands: image.getSamplesPerPixel(),
    crs,
    warnings: crs ? [] : ['GeoTIFF 未包含坐标系信息（GeoKey）'],
  }
}
