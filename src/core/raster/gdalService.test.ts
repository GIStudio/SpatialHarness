/**
 * GDAL 栅格处理服务测试（node env，真实 GDAL WASM）：
 * - 手写 GeoTIFF fixture → gdalInfo / gdal_translate(PNG) / gdalwarp(重投影)
 * - 错误输入处理
 */
import { describe, expect, it } from 'vitest'
import { buildGeoTiff } from '../datasource/geotiffFixture'
import { gdalInfo, gdalTranslate, gdalWarp } from './gdalService'

const tifBytes = buildGeoTiff({ width: 8, height: 8 })
const TIF_NAME = 'fixture.tif'

describe('gdalService（GDAL WASM）', () => {
  it('gdalInfo 返回尺寸/波段/坐标系', async () => {
    const info = await gdalInfo(TIF_NAME, tifBytes)
    expect(info.type).toBe('raster')
    expect(info.width).toBe(8)
    expect(info.height).toBe(8)
    expect(info.bandCount).toBe(1)
    expect(info.projectionWkt).toContain('WGS 84')
    expect(info.corners?.[0]).toEqual([116, 40])
  }, 120000)

  it('gdal_translate 转 PNG', async () => {
    const out = await gdalTranslate(TIF_NAME, tifBytes, ['-of', 'PNG'])
    expect(out.fileName.endsWith('.png') || out.fileName.endsWith('.PNG')).toBe(true)
    // PNG 魔数 \x89PNG
    expect(out.bytes[0]).toBe(0x89)
    expect(String.fromCharCode(out.bytes[1], out.bytes[2], out.bytes[3])).toBe('PNG')
  }, 120000)

  it('gdalwarp 重投影到 EPSG:3857', async () => {
    const out = await gdalWarp(TIF_NAME, tifBytes, ['-of', 'GTiff', '-t_srs', 'EPSG:3857'])
    // TIFF 魔数 II
    expect(String.fromCharCode(out.bytes[0], out.bytes[1])).toBe('II')
    // 重投影后四角不再是经纬度小数，而是 Web 墨卡托米制坐标
    const info = await gdalInfo(out.fileName, out.bytes)
    expect(info.projectionWkt).toMatch(/3857|Pseudo-Mercator|WGS 84 \/ Pseudo/)
    expect(Math.abs(info.corners![0][0])).toBeGreaterThan(1e6)
  }, 120000)

  it('无效输入报错', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    await expect(gdalInfo('bad.tif', garbage)).rejects.toThrow()
  }, 120000)
})
