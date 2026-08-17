/**
 * 最小 GeoTIFF 构造器（测试 fixture 用，纯手写二进制）：
 * 未压缩单波段 8-bit 灰度 + ModelPixelScale/ModelTiepoint + GeoKey（EPSG:4326）。
 * 与 geotiff 库（解析侧）和 GDAL（处理侧）兼容。
 */

export interface GeoTiffFixtureOptions {
  width?: number
  height?: number
  /** 像素尺寸（度），默认 0.1° */
  pixelScale?: number
  /** 左上角坐标（经度/纬度），默认 (116, 40) */
  originLon?: number
  originLat?: number
  /** 逐像素值（row-major），缺省为渐变 */
  values?: number[]
}

/** 生成可被 geotiff.js / GDAL 读取的最小 GeoTIFF 字节 */
export function buildGeoTiff(opts: GeoTiffFixtureOptions = {}): Uint8Array {
  const width = opts.width ?? 8
  const height = opts.height ?? 8
  const scale = opts.pixelScale ?? 0.1
  const lon = opts.originLon ?? 116
  const lat = opts.originLat ?? 40
  const values = opts.values ?? Array.from({ length: width * height }, (_, i) => i % 256)

  const pixelCount = width * height
  // 布局：header(8) + IFD + 外部数据（pixelScale / tiepoint / geoKeys / 像素）
  const entryCount = 12
  const ifdOffset = 8
  const ifdSize = 2 + entryCount * 12 + 4
  let off = ifdOffset + ifdSize
  const align = (n: number) => (off % n === 0 ? off : off + (n - (off % n)))

  const scaleOffset = align(8)
  off = scaleOffset + 24 // 3 doubles
  const tieOffset = align(8)
  off = tieOffset + 48 // 6 doubles
  const keysOffset = align(2)
  const keyCount = 3 // GTModelType / GTRasterType / GeographicType
  const keysLen = 4 + keyCount * 4 // shorts
  off = keysOffset + keysLen * 2
  const dataOffset = align(1)
  off = dataOffset + pixelCount

  const buf = new Uint8Array(off)
  const dv = new DataView(buf.buffer)

  // Header（little-endian TIFF）
  buf[0] = 0x49 // 'I'
  buf[1] = 0x49 // 'I'
  dv.setUint16(2, 0x002a, true)
  dv.setUint32(4, ifdOffset, true)

  // IFD
  dv.setUint16(ifdOffset, entryCount, true)
  let e = ifdOffset + 2
  const entry = (tag: number, type: number, count: number, valueOrOffset: number) => {
    dv.setUint16(e, tag, true)
    dv.setUint16(e + 2, type, true)
    dv.setUint32(e + 4, count, true)
    dv.setUint32(e + 8, valueOrOffset, true)
    e += 12
  }
  // type: 3=SHORT 4=LONG 12=DOUBLE
  entry(256, 4, 1, width) // ImageWidth
  entry(257, 4, 1, height) // ImageLength
  entry(258, 3, 1, 8) // BitsPerSample
  entry(259, 3, 1, 1) // Compression: none
  entry(262, 3, 1, 1) // Photometric: BlackIsZero
  entry(273, 4, 1, dataOffset) // StripOffsets
  entry(277, 3, 1, 1) // SamplesPerPixel
  entry(278, 4, 1, height) // RowsPerStrip
  entry(279, 4, 1, pixelCount) // StripByteCounts
  entry(33550, 12, 3, scaleOffset) // ModelPixelScale
  entry(33922, 12, 6, tieOffset) // ModelTiepoint
  entry(34735, 3, keysLen, keysOffset) // GeoKeyDirectory
  dv.setUint32(e, 0, true) // next IFD = 0

  // ModelPixelScale: (sx, sy, sz)
  dv.setFloat64(scaleOffset, scale, true)
  dv.setFloat64(scaleOffset + 8, scale, true)
  dv.setFloat64(scaleOffset + 16, 0, true)
  // ModelTiepoint: (i, j, k, x, y, z) —— 像素 (0,0) 对应左上角
  dv.setFloat64(tieOffset, 0, true)
  dv.setFloat64(tieOffset + 8, 0, true)
  dv.setFloat64(tieOffset + 16, 0, true)
  dv.setFloat64(tieOffset + 24, lon, true)
  dv.setFloat64(tieOffset + 32, lat, true)
  dv.setFloat64(tieOffset + 40, 0, true)
  // GeoKeyDirectory: version, revision, minor, count, keys…
  let k = keysOffset
  const s = (v: number) => {
    dv.setUint16(k, v, true)
    k += 2
  }
  s(1)
  s(1)
  s(0)
  s(keyCount)
  s(1024) // GTModelTypeGeoKey
  s(0)
  s(1)
  s(2) // ModelTypeGeographic
  s(1025) // GTRasterTypeGeoKey
  s(0)
  s(1)
  s(1) // RasterPixelIsArea
  s(2048) // GeographicTypeGeoKey
  s(0)
  s(1)
  s(4326) // EPSG:4326

  // 像素数据
  for (let i = 0; i < pixelCount; i++) buf[dataOffset + i] = values[i] & 0xff

  return buf
}
