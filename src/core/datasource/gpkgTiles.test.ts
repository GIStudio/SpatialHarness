/**
 * GeoPackage 瓦片表往返测试（node env，纯 JS + UPNG）：
 * - 合成 RGBA 图像 + 4326 bbox → writeGpkgTilesFromImage 写入瓦片表
 * - parseGpkg 读回 → 组装整图（gpkg-tiles 栅格结果），校验 bbox 与像素
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { configureGpkg, parseGpkg, writeGpkgTilesFromImage } from './formats/gpkg'
import { decodePngToRgba, encodeRgbaToPng } from './formats/gpkgTiles'

const require = createRequire(import.meta.url)
const wasmPath = require.resolve('rtree-sql.js/dist/sql-wasm.wasm')

/** 纬度 → Web 墨卡托 y（测试用，与写入路径同源换算） */
function latToMerc(lat: number): number {
  const r = 6378137
  return r * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
}

beforeAll(() => {
  configureGpkg({ wasmBytes: new Uint8Array(readFileSync(wasmPath)) })
})

/** 合成 64×64 RGBA 渐变图（红 → 绿），左上角为不透明 */
function syntheticImage(): { rgba: Uint8Array; width: number; height: number } {
  const width = 64
  const height = 64
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      rgba[i] = (x * 255) / (width - 1)
      rgba[i + 1] = (y * 255) / (height - 1)
      rgba[i + 2] = 100
      rgba[i + 3] = 255
    }
  }
  return { rgba, width, height }
}

describe('geopackage 瓦片表', () => {
  it('写入瓦片表 → 读回组装整图（bbox 与像素近似一致）', async () => {
    const { rgba, width, height } = syntheticImage()
    const png = encodeRgbaToPng(rgba, width, height)
    // 北京西侧小范围 bbox（约 0.4°×0.4°）
    const bbox: [number, number, number, number] = [116.0, 39.8, 116.4, 40.2]

    const gpkgBytes = await writeGpkgTilesFromImage(png, bbox, 'tiles')
    expect(String.fromCharCode(gpkgBytes[0], gpkgBytes[1])).toBe('SQ')

    const buffer = gpkgBytes.buffer.slice(gpkgBytes.byteOffset, gpkgBytes.byteOffset + gpkgBytes.byteLength)
    const results = await parseGpkg(buffer as ArrayBuffer, 'tiles')
    const raster = results.find((r) => r.kind === 'raster')
    expect(raster).toBeDefined()
    if (!raster || raster.kind !== 'raster') return
    expect(raster.format).toBe('gpkg-tiles')
    expect(raster.bbox).toBeDefined()

    // bbox 应覆盖输入 bbox（瓦片网格对齐会略向外扩）
    const [minLon, minLat, maxLon, maxLat] = raster.bbox!
    expect(minLon).toBeLessThanOrEqual(116.0 + 1e-9)
    expect(maxLon).toBeGreaterThanOrEqual(116.4 - 1e-9)
    expect(minLat).toBeLessThanOrEqual(39.8 + 1e-9)
    expect(maxLat).toBeGreaterThanOrEqual(40.2 - 1e-9)

    // 组装整图尺寸应为 256 的整数倍且 ≥ 64
    expect(raster.width % 256).toBe(0)
    expect(raster.height % 256).toBe(0)
    expect(raster.width).toBeGreaterThanOrEqual(width)
    expect(raster.height).toBeGreaterThanOrEqual(height)

    // 解码回读 PNG：按返回 bbox 把源图中心 (116.2, 40.0) 映射回整图像素采样。
    // 纬度方向需按 Web 墨卡托线性插值（bbox 纬度跨度大时线性纬度插值会偏位）
    const back = decodePngToRgba(new Uint8Array(raster.data))
    expect(back.width).toBe(raster.width)
    const [b0, b1, b2, b3] = raster.bbox! // minLon, minLat, maxLon, maxLat
    const mx = ((116.2 - b0) / (b2 - b0)) * raster.width
    const [mercY0, mercY1] = [latToMerc(b1), latToMerc(b3)]
    const my = ((mercY1 - latToMerc(40.0)) / (mercY1 - mercY0)) * raster.height
    const ci = (Math.floor(my) * raster.width + Math.floor(mx)) * 4
    // 源图中心 (x=32,y=32) → (≈129,≈129,100,255)；重采样含整数坐标偏差，容差放宽
    expect(back.rgba[ci + 3]).toBe(255)
    expect(Math.abs(back.rgba[ci] - 129)).toBeLessThanOrEqual(48)
    expect(Math.abs(back.rgba[ci + 1] - 129)).toBeLessThanOrEqual(48)
    expect(Math.abs(back.rgba[ci + 2] - 100)).toBeLessThanOrEqual(24)
  }, 60000)

  it('bbox 参数校验', async () => {
    const { rgba, width, height } = syntheticImage()
    const png = encodeRgbaToPng(rgba, width, height)
    await expect(writeGpkgTilesFromImage(png, [116, 116.5, 40, 39.5], 'bad')).rejects.toThrow()
  }, 60000)
})
