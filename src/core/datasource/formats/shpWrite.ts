/**
 * Shapefile 写入器（纯字节实现，零依赖，Web Worker / Node 通用）：
 * 由 GeoJSON 要素生成 .shp / .shx / .dbf / .prj / .cpg 五个文件的字节。
 *
 * 约定与限制（ESRI Shapefile 规范）：
 * - 单文件单一几何族：点（Point=1 / MultiPoint=8）、线（PolyLine=3）、面（Polygon=5）。
 *   混合图层按多数族导出，其余要素跳过并记 warning。
 * - 几何统一 EPSG:4326（与本工作台内部约定一致），.prj 写 WGS 84（ESRI WKT1）。
 * - .dbf 为 dBASE III：字段名 ≤10 ASCII 字符；字符串按 UTF-8 编码，
 *   LDID 置 0x57 并附 .cpg（内容 UTF-8），与 QGIS / GDAL / shpjs 互通。
 * - 面状要素按规范定向：外环顺时针、内环（孔洞）逆时针（shoelace 面积判向）。
 * - Z/M 坐标忽略，写二维。
 */
import type { Feature, Geometry, Position } from 'geojson'
import { zipStore } from './zipStore'

/* ------------------------------ 常量 ------------------------------ */

export const SHP_POINT = 1
export const SHP_POLYLINE = 3
export const SHP_POLYGON = 5
export const SHP_MULTIPOINT = 8

/** WGS 84 的 ESRI WKT1（数据为 EPSG:4326 时写入 .prj） */
export const WGS84_ESRI_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

const DBF_MAX_C_WIDTH = 254 // dBASE C 字段宽度上限
const DBF_MAX_N_WIDTH = 30 // 数值字段超过此宽度退化为字符串字段

type GeomFamily = 'point' | 'line' | 'polygon'

function familyOf(g: Geometry | null): GeomFamily | null {
  if (!g) return null
  switch (g.type) {
    case 'Point':
    case 'MultiPoint':
      return 'point'
    case 'LineString':
    case 'MultiLineString':
      return 'line'
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon'
    default:
      return null // GeometryCollection 等不支持
  }
}

/* ------------------------------ 几何规整 ------------------------------ */

function closeRing(ring: Position[]): Position[] {
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) return ring
  return [...ring, first]
}

/** shoelace 有向面积：>0 逆时针，<0 顺时针 */
export function signedArea(ring: Position[]): number {
  let sum = 0
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

/** 按 Shapefile 规范定向：外环顺时针（负面积）、孔洞逆时针（正面积） */
function orientRing(ring: Position[], isHole: boolean): Position[] {
  const closed = closeRing(ring)
  if (closed.length < 4) return closed
  const area = signedArea(closed)
  const needNegative = !isHole // 外环要顺时针（负面积）
  if ((area < 0) === needNegative) return closed
  return [...closed].reverse()
}

interface PartGeometry {
  /** PolyLine/Polygon：各 part 的坐标串；MultiPoint/Point：单点列表 */
  parts: Position[][]
}

/** 把要素几何规整为 parts 列表（几何族已过滤一致） */
function toParts(g: Geometry, family: GeomFamily): PartGeometry {
  switch (g.type) {
    case 'Point':
      return { parts: [[g.coordinates]] }
    case 'MultiPoint':
      return { parts: [g.coordinates.map((p) => p)] }
    case 'LineString':
      return { parts: [g.coordinates] }
    case 'MultiLineString':
      return { parts: g.coordinates }
    case 'Polygon':
      return { parts: g.coordinates.map((r, i) => orientRing(r, i > 0)) }
    case 'MultiPolygon':
      return { parts: g.coordinates.flatMap((poly) => poly.map((r, i) => orientRing(r, i > 0))) }
    default:
      return family === 'point' ? { parts: [] } : { parts: [] }
  }
}

function bboxOfPositions(all: Position[][]): [number, number, number, number] {
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (const part of all) {
    for (const [x, y] of part) {
      if (x < xmin) xmin = x
      if (y < ymin) ymin = y
      if (x > xmax) xmax = x
      if (y > ymax) ymax = y
    }
  }
  if (!Number.isFinite(xmin)) return [0, 0, 0, 0]
  return [xmin, ymin, xmax, ymax]
}

/* ------------------------------ .dbf 字段推断 ------------------------------ */

interface DbfField {
  name: string
  type: 'C' | 'N'
  length: number
  decimal: number
}

/** 字段名清洗：仅 ASCII 字母/数字/下划线，≤10 字符，去重 */
function sanitizeFieldName(raw: string, used: Set<string>, index: number): string {
  let name = raw.replace(/[^A-Za-z0-9_]/g, '').slice(0, 10)
  if (name.length === 0) name = `FIELD_${index}`.slice(0, 10)
  let candidate = name
  let suffix = 1
  while (used.has(candidate.toUpperCase())) {
    const sfx = `_${suffix}`
    candidate = name.slice(0, 10 - sfx.length) + sfx
    suffix++
  }
  used.add(candidate.toUpperCase())
  return candidate
}

/** 按 UTF-8 字节数截断（不切碎多字节字符） */
function truncateUtf8(s: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length <= maxBytes) return s
  let end = maxBytes
  // 回退到 UTF-8 字符边界（10xxxxxx 续字节）
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return new TextDecoder().decode(bytes.slice(0, end))
}

interface FieldValues {
  key: string
  values: unknown[]
}

function inferDbfFields(features: Feature[], warnings: string[]): { fields: DbfField[]; columns: FieldValues[] } {
  const keys: string[] = []
  for (const f of features) {
    for (const k of Object.keys(f.properties ?? {})) {
      if (!keys.includes(k)) keys.push(k)
    }
  }

  const usedNames = new Set<string>()
  const fields: DbfField[] = []
  const columns: FieldValues[] = []

  keys.forEach((key, i) => {
    const values = features.map((f) => (f.properties ?? {})[key] ?? null)
    const name = sanitizeFieldName(key, usedNames, i)
    if (name !== key) warnings.push(`字段名「${key}」已改写为「${name}」（dBASE 仅支持 ≤10 位 ASCII）`)

    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '')
    const allNumeric = nonNull.length > 0 && nonNull.every((v) => typeof v === 'number' && Number.isFinite(v))

    if (allNumeric) {
      let maxInt = 1
      let maxDec = 0
      for (const v of nonNull) {
        const s = String(v)
        const dot = s.indexOf('.')
        const intPart = dot < 0 ? s : s.slice(0, dot)
        maxInt = Math.max(maxInt, intPart.length)
        maxDec = Math.max(maxDec, dot < 0 ? 0 : s.length - dot - 1)
      }
      const width = maxInt + (maxDec > 0 ? maxDec + 1 : 0)
      if (width <= DBF_MAX_N_WIDTH) {
        fields.push({ name, type: 'N', length: width, decimal: maxDec })
        columns.push({ key, values })
        return
      }
      warnings.push(`字段「${key}」数值过宽（${width} 位），退化为字符串字段`)
    }

    let maxBytes = 1
    let truncated = false
    for (const v of values) {
      if (v === null || v === undefined) continue
      const byteLen = new TextEncoder().encode(String(v)).length
      if (byteLen > DBF_MAX_C_WIDTH) truncated = true
      maxBytes = Math.max(maxBytes, Math.min(byteLen, DBF_MAX_C_WIDTH))
    }
    if (truncated) warnings.push(`字段「${key}」存在超过 ${DBF_MAX_C_WIDTH} 字节的值，已截断`)
    fields.push({ name, type: 'C', length: maxBytes, decimal: 0 })
    columns.push({ key, values })
  })

  // 无属性时补 FID 字段（与 GDAL 行为一致），避免生成 0 字段的退化 dbf
  if (fields.length === 0) {
    fields.push({ name: 'FID', type: 'N', length: 10, decimal: 0 })
    columns.push({ key: '__fid__', values: features.map((_, i) => i + 1) })
  }
  return { fields, columns }
}

/* ------------------------------ .dbf 序列化 ------------------------------ */

function buildDbf(fields: DbfField[], columns: FieldValues[], recordCount: number): Uint8Array {
  const headerLen = 32 + 32 * fields.length + 1
  const recordLen = 1 + fields.reduce((s, f) => s + f.length, 0)
  const out = new Uint8Array(headerLen + recordCount * recordLen + 1) // +1: EOF 0x1A
  const dv = new DataView(out.buffer)
  const enc = new TextEncoder()

  dv.setUint8(0, 0x03) // dBASE III
  const now = new Date()
  dv.setUint8(1, now.getFullYear() - 1900)
  dv.setUint8(2, now.getMonth() + 1)
  dv.setUint8(3, now.getDate())
  dv.setUint32(4, recordCount, true)
  dv.setUint16(8, headerLen, true)
  dv.setUint16(10, recordLen, true)
  dv.setUint8(29, 0x57) // LDID：GDAL 约定的 UTF-8 标记

  let off = 32
  for (const f of fields) {
    const nameBytes = enc.encode(f.name).slice(0, 11)
    out.set(nameBytes, off)
    for (let i = nameBytes.length; i < 11; i++) out[off + i] = 0x20
    dv.setUint8(off + 11, f.type.charCodeAt(0))
    dv.setUint8(off + 16, f.length)
    dv.setUint8(off + 17, f.decimal)
    off += 32
  }
  dv.setUint8(off, 0x0d) // 头终止符
  off = headerLen

  for (let r = 0; r < recordCount; r++) {
    out[off] = 0x20 // 删除标志：有效记录
    off++
    fields.forEach((f, ci) => {
      const raw = columns[ci].values[r]
      let text: string
      if (raw === null || raw === undefined || raw === '') text = ''
      else if (f.type === 'N') {
        const num = typeof raw === 'number' ? raw : Number(raw)
        text = Number.isFinite(num) ? (f.decimal > 0 ? num.toFixed(f.decimal) : String(Math.trunc(num))) : ''
      } else text = truncateUtf8(String(raw), f.length)

      const bytes = enc.encode(text)
      if (f.type === 'N') {
        // 数值右对齐，左侧补空格
        const pad = f.length - bytes.length
        for (let i = 0; i < pad; i++) out[off + i] = 0x20
        out.set(bytes.subarray(0, f.length), off + pad)
      } else {
        out.set(bytes.subarray(0, f.length), off)
        for (let i = bytes.length; i < f.length; i++) out[off + i] = 0x20
      }
      off += f.length
    })
  }
  out[out.length - 1] = 0x1a // EOF
  return out
}

/* ------------------------------ .shp / .shx 序列化 ------------------------------ */

function recordContentLength(shapeType: number, parts: Position[][]): number {
  if (shapeType === SHP_POINT) return 4 + 16
  if (shapeType === SHP_MULTIPOINT) return 4 + 32 + 4 + 16 * parts[0].length
  const numPoints = parts.reduce((s, p) => s + p.length, 0)
  return 4 + 32 + 4 + 4 + 4 * parts.length + 16 * numPoints
}

function writeShpRecords(shapeType: number, geoms: PartGeometry[], bbox: [number, number, number, number]): { shp: Uint8Array; shx: Uint8Array } {
  const contentLens = geoms.map((g) => recordContentLength(shapeType, g.parts))
  const shpLen = 100 + contentLens.reduce((s, len) => s + 8 + len, 0)
  const shxLen = 100 + 8 * geoms.length
  const shp = new Uint8Array(shpLen)
  const shx = new Uint8Array(shxLen)
  const dv = new DataView(shp.buffer)
  const dx = new DataView(shx.buffer)

  const writeHeader = (d: DataView, fileLen: number) => {
    d.setInt32(0, 9994, false)
    d.setInt32(24, fileLen / 2, false) // 16 位字
    d.setInt32(28, 1000, true)
    d.setInt32(32, shapeType, true)
    d.setFloat64(36, bbox[0], true) // xmin
    d.setFloat64(44, bbox[1], true) // ymin
    d.setFloat64(52, bbox[2], true) // xmax
    d.setFloat64(60, bbox[3], true) // ymax
    // zmin/zmax/mmin/mmax 保持 0
  }
  writeHeader(dv, shpLen)
  writeHeader(dx, shxLen)

  let off = 100
  let xoff = 100
  geoms.forEach((g, i) => {
    const contentLen = contentLens[i]
    // .shp 记录头（大端：记录号、内容长度/字）
    dv.setInt32(off, i + 1, false)
    dv.setInt32(off + 4, contentLen / 2, false)
    // .shx 索引项（大端：偏移/字、内容长度/字）
    dx.setInt32(xoff, off / 2, false)
    dx.setInt32(xoff + 4, contentLen / 2, false)
    xoff += 8

    let c = off + 8
    dv.setInt32(c, shapeType, true)
    c += 4
    if (shapeType === SHP_POINT) {
      const [x, y] = g.parts[0][0]
      dv.setFloat64(c, x, true)
      dv.setFloat64(c + 8, y, true)
    } else if (shapeType === SHP_MULTIPOINT) {
      const pts = g.parts[0]
      const [xmin, ymin, xmax, ymax] = bboxOfPositions([pts])
      dv.setFloat64(c, xmin, true)
      dv.setFloat64(c + 8, ymin, true)
      dv.setFloat64(c + 16, xmax, true)
      dv.setFloat64(c + 24, ymax, true)
      dv.setInt32(c + 32, pts.length, true)
      c += 36
      for (const [x, y] of pts) {
        dv.setFloat64(c, x, true)
        dv.setFloat64(c + 8, y, true)
        c += 16
      }
    } else {
      // PolyLine / Polygon
      const [xmin, ymin, xmax, ymax] = bboxOfPositions(g.parts)
      dv.setFloat64(c, xmin, true)
      dv.setFloat64(c + 8, ymin, true)
      dv.setFloat64(c + 16, xmax, true)
      dv.setFloat64(c + 24, ymax, true)
      const numPoints = g.parts.reduce((s, p) => s + p.length, 0)
      dv.setInt32(c + 32, g.parts.length, true)
      dv.setInt32(c + 36, numPoints, true)
      c += 40
      let idx = 0
      for (const part of g.parts) {
        dv.setInt32(c, idx, true)
        idx += part.length
        c += 4
      }
      for (const part of g.parts) {
        for (const [x, y] of part) {
          dv.setFloat64(c, x, true)
          dv.setFloat64(c + 8, y, true)
          c += 16
        }
      }
    }
    off += 8 + contentLen
  })

  return { shp, shx }
}

/* ------------------------------ 入口 ------------------------------ */

export interface ShapefileParts {
  shp: Uint8Array
  shx: Uint8Array
  dbf: Uint8Array
  prj: string
  cpg: string
  shapeType: number
  exported: number
  skipped: number
  warnings: string[]
}

/** 由要素集合生成 Shapefile 全套文件字节 */
export function writeShapefileParts(features: Feature[]): ShapefileParts {
  const warnings: string[] = []

  // 1. 几何族判定：按多数族导出
  const counts: Record<GeomFamily, number> = { point: 0, line: 0, polygon: 0 }
  for (const f of features) {
    const fam = familyOf(f.geometry)
    if (fam) counts[fam]++
  }
  const family = (['polygon', 'line', 'point'] as GeomFamily[]).reduce((best, fam) =>
    counts[fam] > counts[best] ? fam : best,
  )
  if (counts[family] === 0) throw new Error('没有可导出的要素（无有效几何）')

  const kept: Feature[] = []
  let skipped = 0
  for (const f of features) {
    if (familyOf(f.geometry) === family) kept.push(f)
    else skipped++
  }
  if (skipped > 0) {
    warnings.push(`Shapefile 仅支持单一几何类型：已跳过 ${skipped} 个非${family === 'point' ? '点' : family === 'line' ? '线' : '面'}要素`)
  }

  // 2. 几何规整与 shape type
  const hasMulti = kept.some((f) => f.geometry!.type === 'MultiPoint')
  const shapeType = family === 'point' ? (hasMulti ? SHP_MULTIPOINT : SHP_POINT) : family === 'line' ? SHP_POLYLINE : SHP_POLYGON
  const geoms = kept.map((f) => toParts(f.geometry!, family))
  const allPositions = geoms.flatMap((g) => g.parts)
  const bbox = bboxOfPositions(allPositions)

  // 3. 属性字段与记录
  const { fields, columns } = inferDbfFields(kept, warnings)
  const dbf = buildDbf(fields, columns, kept.length)

  // 4. 几何文件
  const { shp, shx } = writeShpRecords(shapeType, geoms, bbox)

  return { shp, shx, dbf, prj: WGS84_ESRI_WKT, cpg: 'UTF-8', shapeType, exported: kept.length, skipped, warnings }
}

/** 文件名主干清洗（去掉路径与非法字符） */
export function sanitizeFileStem(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned.length > 0 ? cleaned : 'layer'
}

/** 打包为 .zip（shp/shx/dbf/prj/cpg 五件套） */
export function buildShapefileZip(parts: ShapefileParts, stem: string): Uint8Array {
  const enc = new TextEncoder()
  return zipStore([
    { name: `${stem}.shp`, data: parts.shp },
    { name: `${stem}.shx`, data: parts.shx },
    { name: `${stem}.dbf`, data: parts.dbf },
    { name: `${stem}.prj`, data: enc.encode(parts.prj) },
    { name: `${stem}.cpg`, data: enc.encode(parts.cpg) },
  ])
}
