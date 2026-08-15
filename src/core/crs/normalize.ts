/**
 * 几何坐标系归一化：把任意已知坐标系下的几何转换到 EPSG:4326。
 * 用于导入阶段（Shapefile 带 .prj、GeoTIFF 自带 CRS 等）。
 */
import proj4 from 'proj4'
import type { Feature, Geometry, Position } from 'geojson'
import { ensureCrsDefined } from './registry'

function transformPos(pos: Position, conv: (p: [number, number]) => [number, number]): Position {
  const [x, y] = conv([pos[0], pos[1]])
  if (pos.length > 2) return [x, y, ...pos.slice(2)]
  return [x, y]
}

function transformGeom(geom: Geometry | null, conv: (p: [number, number]) => [number, number]): Geometry | null {
  if (!geom) return null
  switch (geom.type) {
    case 'Point':
      return { ...geom, coordinates: transformPos(geom.coordinates, conv) }
    case 'MultiPoint':
      return { ...geom, coordinates: geom.coordinates.map((p) => transformPos(p, conv)) }
    case 'LineString':
      return { ...geom, coordinates: geom.coordinates.map((p) => transformPos(p, conv)) }
    case 'MultiLineString':
      return { ...geom, coordinates: geom.coordinates.map((l) => l.map((p) => transformPos(p, conv))) }
    case 'Polygon':
      return { ...geom, coordinates: geom.coordinates.map((ring) => ring.map((p) => transformPos(p, conv))) }
    case 'MultiPolygon':
      return {
        ...geom,
        coordinates: geom.coordinates.map((poly) => poly.map((ring) => ring.map((p) => transformPos(p, conv)))),
      }
    case 'GeometryCollection':
      return { ...geom, geometries: geom.geometries.map((g) => transformGeom(g, conv)).filter((g): g is Geometry => g !== null) }
    default:
      return geom
  }
}

/**
 * 将要素集合从 sourceCrs（如 'EPSG:4490' 或自定义 proj4 def 代码）转换到 EPSG:4326。
 * 已是 4326 时原样返回。未知坐标系时返回原数据并标记未转换。
 */
export function normalizeToWgs84(
  features: Feature[],
  sourceCrs?: string,
): { features: Feature[]; converted: boolean; crs: string | null } {
  if (!sourceCrs || sourceCrs === 'EPSG:4326') return { features, converted: false, crs: sourceCrs ?? 'EPSG:4326' }
  let conv: ((p: [number, number]) => [number, number]) | null = null
  try {
    ensureCrsDefined(sourceCrs)
    // proj4.defs 已知（内置、注册表或 __custom__）才可转换
    if (!proj4.defs(sourceCrs)) return { features, converted: false, crs: sourceCrs }
    const f = proj4(sourceCrs, 'EPSG:4326')
    conv = (p) => {
      const out = f.forward(p as [number, number])
      return [out[0], out[1]]
    }
  } catch {
    return { features, converted: false, crs: sourceCrs }
  }
  return {
    features: features.map((f) => {
      if (!f.geometry) return f
      return { ...f, geometry: transformGeom(f.geometry, conv!)! }
    }),
    converted: true,
    crs: sourceCrs,
  }
}

/** 从坐标推断 CGCS2000 带号（Y 横坐标 >> 1e7 时） */
export function looksLikeGkZone(x: number, _y: number): boolean {
  return Math.abs(x) > 1e7
}
