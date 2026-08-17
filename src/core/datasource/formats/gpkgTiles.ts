/**
 * GeoPackage 瓦片表读写（纯 JS + UPNG，Web Worker / Node 通用）：
 * - 读：瓦片表 → 选取可组装的最高层级 → 解码 PNG 瓦片拼接为整图（含 4326 bbox）
 * - 写：RGBA 图像 + 4326 bbox → EPSG:3857 XYZ 瓦片矩阵（256px PNG 瓦片）写入 gpkg
 *
 * JPEG 瓦片暂不解码（缺纯 JS 解码器），读取时跳过并告警。
 */
import UPNG from 'upng-js'
import { toLonLat, toWebMercator } from '@/core/geo/transform'

const WEB_MERCATOR_HALF = 20037508.342789244
const WEB_MERCATOR_RES_Z0 = 156543.03392804097
const TILE_SIZE = 256
/** 组装整图的像素上限（防止超大瓦片金字塔撑爆内存） */
const MAX_ASSEMBLE_PX = 4096
/** 写入时单层瓦片数量上限 */
const MAX_WRITE_TILES = 256

/* ------------------------------ 类型 ------------------------------ */

export interface TileReadResult {
  pngBytes: Uint8Array
  width: number
  height: number
  /** EPSG:4326 [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number]
  warnings: string[]
}

interface TileMatrixLike {
  zoom_level: number
  matrix_width: number
  matrix_height: number
  tile_width: number
  tile_height: number
  pixel_x_size: number
  pixel_y_size: number
}

interface TileRowLike {
  zoomLevel?: number
  tileColumn?: number
  /** 注意：库的 TileRow 行号 getter 名为 `row`（tileRow 仅有 setter） */
  row?: number
  tileRow?: number
  zoom_level?: number
  tile_column?: number
  tile_row?: number
  tileData?: Uint8Array | null
  tile_data?: Uint8Array | null
}

interface TileDaoLike {
  tileMatrices: TileMatrixLike[]
  tileMatrixSet: { min_x: number; min_y: number; max_x: number; max_y: number; srs_id: number }
  srs: { organization: string; organization_coordsys_id: number }
  minZoom: number
  maxZoom: number
  getTileMatrixWithZoomLevel(z: number): TileMatrixLike | undefined
  queryForTilesWithZoomLevel(z: number): Iterable<TileRowLike>
}

export interface GeoPackageTilesLike {
  getTileDao(table: string): TileDaoLike
  addTile(data: Uint8Array, table: string, zoom: number, tileRow: number, tileColumn: number): unknown
  createStandardWebMercatorTileTable(
    tableName: string,
    contentsBBox: unknown,
    contentsSrsId: number,
    tmsBBox: unknown,
    tmsSrsId: number,
    minZoom: number,
    maxZoom: number,
    tileSize?: number,
  ): unknown
  createTileTableWithTableName(
    tableName: string,
    contentsBBox: unknown,
    contentsSrsId: number,
    tmsBBox: unknown,
    tmsSrsId: number,
  ): { table_name?: string }
  createTileMatrixRow(tmsBBox: unknown, tileMatrixSet: { table_name?: string }, tileMatrixDao: unknown, zoom: number, tileSize: number): unknown
  tileMatrixDao: unknown
  spatialReferenceSystemDao: { createWebMercator(): number }
  export(): Promise<Uint8Array>
  close(): void
}

/* ------------------------------ PNG 工具 ------------------------------ */

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

/** 解码 PNG → RGBA */
export function decodePngToRgba(bytes: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  const img = UPNG.decode(bytes)
  let rgba: Uint8Array
  if (img.ctype === 6 && img.channels === 4) {
    rgba = img.data
  } else {
    rgba = new Uint8Array(UPNG.toRGBA8(img)[0])
  }
  return { rgba, width: img.width, height: img.height }
}

/** RGBA → PNG 字节 */
export function encodeRgbaToPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  return new Uint8Array(UPNG.encode([rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)], width, height, 0))
}

/* ------------------------------ 读取 ------------------------------ */

/**
 * 读取 gpkg 瓦片表并组装为整图。
 * 从最高层级向下找第一个「网格 ≤ 像素上限且有瓦片」的层级。
 */
export function readTileTable(gp: GeoPackageTilesLike, tableName: string): TileReadResult | null {
  const dao = gp.getTileDao(tableName)
  const tms = dao.tileMatrixSet
  const epsg = dao.srs?.organization_coordsys_id
  const warnings: string[] = []
  if (epsg !== 3857 && epsg !== 4326) {
    warnings.push(`瓦片表 ${tableName} 使用 EPSG:${epsg}，当前仅支持 3857/4326，已跳过`)
    return null
  }

  // 从最高层级向下找第一个「实际瓦片范围 ≤ 像素上限」的层级；
  // 若都不满足则退而取瓦片最少（最低层级）的候选。
  interface Decoded { col: number; row: number; rgba: Uint8Array; w: number; h: number }
  let fallback: { zoom: number; matrix: TileMatrixLike; decoded: Decoded[]; tileW: number; tileH: number } | null = null

  for (let z = dao.maxZoom; z >= dao.minZoom; z--) {
    const matrix = dao.getTileMatrixWithZoomLevel(z)
    if (!matrix) continue
    const tileW = matrix.tile_width
    const tileH = matrix.tile_height
    const tiles = [...dao.queryForTilesWithZoomLevel(z)].filter((t) => {
      const data = t.tileData ?? t.tile_data
      return data && data.length > 0
    })
    if (tiles.length === 0) continue

    const decoded: Decoded[] = []
    for (const t of tiles) {
      const data = (t.tileData ?? t.tile_data)!
      if (!isPng(data)) continue
      try {
        const { rgba, width, height } = decodePngToRgba(data)
        decoded.push({ col: t.tileColumn ?? t.tile_column ?? 0, row: t.row ?? t.tileRow ?? t.tile_row ?? 0, rgba, w: width, h: height })
      } catch {
        warnings.push(`瓦片表 ${tableName} 存在无法解码的 PNG 瓦片，已跳过`)
      }
    }
    if (decoded.length === 0) continue

    const minCol = Math.min(...decoded.map((d) => d.col))
    const maxCol = Math.max(...decoded.map((d) => d.col))
    const minRow = Math.min(...decoded.map((d) => d.row))
    const maxRow = Math.max(...decoded.map((d) => d.row))
    const canvasW = (maxCol - minCol + 1) * tileW
    const canvasH = (maxRow - minRow + 1) * tileH

    // 记录更低层级的候选（瓦片范围更小）
    fallback = { zoom: z, matrix, decoded, tileW, tileH }
    if (canvasW <= MAX_ASSEMBLE_PX && canvasH <= MAX_ASSEMBLE_PX) {
      return assembleTiles(tms, epsg, warnings, matrix, tileW, tileH, decoded)
    }
  }

  if (fallback) {
    warnings.push(`瓦片表 ${tableName} 的完整网格超过 ${MAX_ASSEMBLE_PX}px，已按实际瓦片范围组装`)
    return assembleTiles(tms, epsg, warnings, fallback.matrix, fallback.tileW, fallback.tileH, fallback.decoded)
  }

  warnings.push(`瓦片表 ${tableName} 没有可组装的瓦片`)
  return null
}

/** 把已解码瓦片拼成整图（共享的 bbox 反算与 PNG 编码逻辑） */
function assembleTiles(
  tms: { min_x: number; min_y: number; max_x: number; max_y: number },
  epsg: number,
  warnings: string[],
  matrix: TileMatrixLike,
  tileW: number,
  tileH: number,
  decoded: { col: number; row: number; rgba: Uint8Array; w: number; h: number }[],
): TileReadResult | null {
  const minCol = Math.min(...decoded.map((d) => d.col))
  const maxCol = Math.max(...decoded.map((d) => d.col))
  const minRow = Math.min(...decoded.map((d) => d.row))
  const maxRow = Math.max(...decoded.map((d) => d.row))
  const width = (maxCol - minCol + 1) * tileW
  const height = (maxRow - minRow + 1) * tileH
  const canvas = new Uint8Array(width * height * 4)
  for (const d of decoded) {
    const ox = (d.col - minCol) * tileW
    const oy = (d.row - minRow) * tileH
    for (let y = 0; y < Math.min(d.h, tileH); y++) {
      const srcStart = y * d.w * 4
      const dstStart = ((oy + y) * width + ox) * 4
      canvas.set(d.rgba.subarray(srcStart, srcStart + Math.min(d.w, tileW) * 4), dstStart)
    }
  }

  // 由瓦片网格范围反算 bbox（TMS 坐标系 → 4326）
  const x0 = tms.min_x + minCol * tileW * matrix.pixel_x_size
  const yTop = tms.max_y - minRow * tileH * matrix.pixel_y_size
  const x1 = x0 + width * matrix.pixel_x_size
  const y0 = yTop - height * matrix.pixel_y_size
  let bbox: [number, number, number, number]
  if (epsg === 3857) {
    const [lon0, lat0] = toLonLat([x0, y0])
    const [lon1, lat1] = toLonLat([x1, yTop])
    bbox = [lon0, lat0, lon1, lat1]
  } else {
    bbox = [x0, y0, x1, yTop]
  }

  return { pngBytes: encodeRgbaToPng(canvas, width, height), width, height, bbox, warnings }
}

/* ------------------------------ 写入 ------------------------------ */

/** Web 墨卡托 XYZ 瓦片范围计算 */
function xyzRangeForBbox(x0: number, y0: number, x1: number, y1: number, zoom: number) {
  const res = WEB_MERCATOR_RES_Z0 / Math.pow(2, zoom)
  const side = TILE_SIZE * res
  const maxIdx = Math.pow(2, zoom) - 1
  const clamp = (v: number) => Math.max(0, Math.min(maxIdx, v))
  const colMin = clamp(Math.floor((x0 + WEB_MERCATOR_HALF) / side))
  const colMax = clamp(Math.floor((x1 - 1e-9 + WEB_MERCATOR_HALF) / side))
  const rowMin = clamp(Math.floor((WEB_MERCATOR_HALF - y1) / side)) // 行 0 在北
  const rowMax = clamp(Math.floor((WEB_MERCATOR_HALF - y0 - 1e-9) / side))
  return { colMin, colMax, rowMin, rowMax, res }
}

/**
 * 将 RGBA 图像 + 4326 bbox 写入 gpkg 瓦片表（EPSG:3857 XYZ，256px PNG）。
 * 返回 gpkg 字节；zoom 依据源分辨率自动选择（单层金字塔）。
 */
export async function writeGpkgTiles(
  gpFactory: () => Promise<GeoPackageTilesLike>,
  bboxFactory: (minX: number, maxX: number, minY: number, maxY: number) => unknown,
  pngBytes: Uint8Array,
  bbox4326: [number, number, number, number],
  tableName: string,
): Promise<Uint8Array> {
  const { rgba, width, height } = decodePngToRgba(pngBytes)
  const [lon0, lat0, lon1, lat1] = bbox4326
  if (lon0 >= lon1 || lat0 >= lat1) throw new Error('无效的 bbox（min 必须小于 max）')
  const clampLat = (v: number) => Math.max(-85.05112878, Math.min(85.05112878, v))
  const [x0, y0] = toWebMercator([lon0, clampLat(lat0)])
  const [x1, y1] = toWebMercator([lon1, clampLat(lat1)])

  // zoom：匹配源分辨率，再按瓦片数量上限回退
  const resSrc = Math.max((x1 - x0) / width, (y1 - y0) / height)
  let zoom = Math.max(0, Math.min(19, Math.round(Math.log2(WEB_MERCATOR_RES_Z0 / resSrc))))
  let range = xyzRangeForBbox(x0, y0, x1, y1, zoom)
  while (zoom > 0 && (range.colMax - range.colMin + 1) * (range.rowMax - range.rowMin + 1) > MAX_WRITE_TILES) {
    zoom--
    range = xyzRangeForBbox(x0, y0, x1, y1, zoom)
  }
  const { colMin, colMax, rowMin, rowMax, res } = range

  const gp = await gpFactory()
  try {
    const srsId = gp.spatialReferenceSystemDao.createWebMercator()
    const contentsBBox = bboxFactory(x0, x1, y0, y1)
    const tmsBBox = bboxFactory(-WEB_MERCATOR_HALF, WEB_MERCATOR_HALF, -WEB_MERCATOR_HALF, WEB_MERCATOR_HALF)
    // 拆开库的两个便利方法：createTileTableWithTableName 返回的 tms 需显式带 table_name
    const tms = gp.createTileTableWithTableName(tableName, contentsBBox, srsId, tmsBBox, srsId)
    if (!tms.table_name) tms.table_name = tableName
    gp.createTileMatrixRow(tmsBBox, tms, gp.tileMatrixDao, zoom, TILE_SIZE)

    const srcW = x1 - x0
    const srcH = y1 - y0
    const side = TILE_SIZE * res
    for (let col = colMin; col <= colMax; col++) {
      for (let row = rowMin; row <= rowMax; row++) {
        const tx0 = -WEB_MERCATOR_HALF + col * side
        const ty1 = WEB_MERCATOR_HALF - row * side
        const tile = new Uint8Array(TILE_SIZE * TILE_SIZE * 4)
        let hasData = false
        for (let py = 0; py < TILE_SIZE; py++) {
          const worldY = ty1 - (py + 0.5) * res
          const sy = Math.floor(((y1 - worldY) / srcH) * height)
          if (sy < 0 || sy >= height) continue
          for (let px = 0; px < TILE_SIZE; px++) {
            const worldX = tx0 + (px + 0.5) * res
            const sx = Math.floor(((worldX - x0) / srcW) * width)
            if (sx < 0 || sx >= width) continue
            const si = (sy * width + sx) * 4
            const di = (py * TILE_SIZE + px) * 4
            tile[di] = rgba[si]
            tile[di + 1] = rgba[si + 1]
            tile[di + 2] = rgba[si + 2]
            tile[di + 3] = rgba[si + 3]
            hasData = true
          }
        }
        if (hasData) {
          gp.addTile(encodeRgbaToPng(tile, TILE_SIZE, TILE_SIZE), tableName, zoom, row, col)
        }
      }
    }
    return await gp.export()
  } finally {
    gp.close()
  }
}
