/**
 * 常见坐标系注册表（proj4 定义）与 WKT(.prj) 解析。
 *
 * 设计：导入数据时把几何统一归一化到 EPSG:4326 供业务与显示使用，
 * 原始坐标系保留在图层元信息中。视图坐标系恒为 EPSG:3857。
 */
import proj4 from 'proj4'

export interface CrsInfo {
  /** 显示名 */
  name: string
  /** proj4 定义串（缺省表示 proj4 内置：4326/3857） */
  def?: string
  /** 是否为地理坐标系（度） */
  geographic?: boolean
}

export const CRS_REGISTRY: Record<string, CrsInfo> = {
  'EPSG:4326': { name: 'WGS 84 / 经纬度', geographic: true },
  'EPSG:3857': { name: 'Web Mercator / 伪墨卡托' },
  'EPSG:4490': { name: 'CGCS2000 地理坐标系', geographic: true, def: '+proj=longlat +ellps=GRS80 +no_defs +type=crs' },
  'EPSG:4610': { name: '西安 1980 地理坐标系', geographic: true, def: '+proj=longlat +ellps=IAU76 +no_defs +type=crs' },
  'EPSG:4214': { name: '北京 1954 地理坐标系', geographic: true, def: '+proj=longlat +ellps=krass +no_defs +type=crs' },
  'EPSG:4547': { name: 'CGCS2000 / 3度带 25', def: '+proj=tmerc +lat_0=0 +lon_0=75 +k=1 +x_0=25500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4548': { name: 'CGCS2000 / 3度带 26', def: '+proj=tmerc +lat_0=0 +lon_0=78 +k=1 +x_0=26500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4549': { name: 'CGCS2000 / 3度带 27', def: '+proj=tmerc +lat_0=0 +lon_0=81 +k=1 +x_0=27500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4550': { name: 'CGCS2000 / 3度带 28', def: '+proj=tmerc +lat_0=0 +lon_0=84 +k=1 +x_0=28500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4551': { name: 'CGCS2000 / 3度带 29', def: '+proj=tmerc +lat_0=0 +lon_0=87 +k=1 +x_0=29500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4552': { name: 'CGCS2000 / 3度带 30', def: '+proj=tmerc +lat_0=0 +lon_0=90 +k=1 +x_0=30500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4545': { name: 'CGCS2000 / 3度带 23', def: '+proj=tmerc +lat_0=0 +lon_0=69 +k=1 +x_0=23500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4546': { name: 'CGCS2000 / 3度带 24', def: '+proj=tmerc +lat_0=0 +lon_0=72 +k=1 +x_0=24500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4491': { name: 'CGCS2000 / 6度带 13', def: '+proj=tmerc +lat_0=0 +lon_0=75 +k=1 +x_0=13500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4492': { name: 'CGCS2000 / 6度带 14', def: '+proj=tmerc +lat_0=0 +lon_0=81 +k=1 +x_0=14500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4493': { name: 'CGCS2000 / 6度带 15', def: '+proj=tmerc +lat_0=0 +lon_0=87 +k=1 +x_0=15500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4494': { name: 'CGCS2000 / 6度带 16', def: '+proj=tmerc +lat_0=0 +lon_0=93 +k=1 +x_0=16500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4495': { name: 'CGCS2000 / 6度带 17', def: '+proj=tmerc +lat_0=0 +lon_0=99 +k=1 +x_0=17500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4496': { name: 'CGCS2000 / 6度带 18', def: '+proj=tmerc +lat_0=0 +lon_0=105 +k=1 +x_0=18500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4497': { name: 'CGCS2000 / 6度带 19', def: '+proj=tmerc +lat_0=0 +lon_0=111 +k=1 +x_0=19500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4498': { name: 'CGCS2000 / 6度带 20', def: '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=20500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4499': { name: 'CGCS2000 / 6度带 21', def: '+proj=tmerc +lat_0=0 +lon_0=123 +k=1 +x_0=21500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4500': { name: 'CGCS2000 / 6度带 22', def: '+proj=tmerc +lat_0=0 +lon_0=129 +k=1 +x_0=22500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
  'EPSG:4501': { name: 'CGCS2000 / 6度带 23', def: '+proj=tmerc +lat_0=0 +lon_0=135 +k=1 +x_0=23500000 +ellps=GRS80 +units=m +no_defs +type=crs' },
}

/** 常用 CGCS2000 高斯投影带号 → EPSG（按经度/横坐标自动推断） */
export function inferCgcsZone(x: number, _y: number): string | null {
  // 带号可以从带号的 Y 坐标（去掉 500km 假东偏移后取整百万）推断
  const zone = Math.round((x - 500000) / 1000000)
  if (zone < 13 || zone > 23) return null
  // 6 度带
  return `EPSG:${4491 + (zone - 13)}`
}

/** 注册 proj4 定义（幂等） */
export function ensureCrsDefined(code: string): boolean {
  if (code === 'EPSG:4326' || code === 'EPSG:3857') return true
  // 已在 proj4 中注册的定义（如 resolvePrj 写入的 '__custom__'）直接可用
  if (proj4.defs(code)) return true
  const info = CRS_REGISTRY[code]
  if (!info?.def) return false
  try {
    if (!proj4.defs(code)) proj4.defs(code, info.def)
    return true
  } catch {
    return false
  }
}

/**
 * 将 WKT(.prj) 文本转换为 proj4 定义串（支持常见投影）。
 * 优先提取 AUTHORITY["EPSG","xxxx"]；否则解析 PROJCS 参数。
 */
export function wktToProj4(wkt: string): { code?: string; def?: string; name?: string } {
  if (!wkt) return {}
  // 1. 优先 EPSG authority
  const epsgMatch = wkt.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"(\d+)"\s*\]/)
  if (epsgMatch) return { code: `EPSG:${epsgMatch[1]}` }
  // 2. 地理坐标系
  if (/^GEOGCS/i.test(wkt.trim()) || /^GEOCCS/i.test(wkt.trim())) {
    return { def: '+proj=longlat +datum=WGS84 +no_defs +type=crs' }
  }
  // 3. 投影坐标系参数解析
  const nameMatch = wkt.match(/PROJCS\s*\[\s*"([^"]+)"/)
  const name = nameMatch?.[1]
  const projMatch = wkt.match(/PROJECTION\s*\[\s*"([^"]+)"/)
  const projName = projMatch?.[1]
  if (!projName) return { name }
  const param = (key: string): number | null => {
    const m = wkt.match(new RegExp(`PARAMETER\\s*\\[\\s*"${key}"\\s*,\\s*([-\\d.]+)`))
    return m ? parseFloat(m[1]) : null
  }
  const datumMatch = wkt.match(/DATUM\s*\[\s*"([^"]+)"/)
  const datum = datumMatch?.[1] ?? ''
  const ellps = /CGCS2000|China_2000/i.test(datum) || /GRS.?1980/i.test(wkt) ? 'GRS80'
    : /Krassowsky|Krasovsky|Beijing/i.test(wkt) ? 'krass'
    : /Xian|IAG.?1975|IAU.?1976/i.test(wkt) ? 'IAU76' : 'WGS84'
  const centralMeridian = param('central_meridian')
  const scaleFactor = param('scale_factor') ?? 1
  const falseEasting = param('false_easting') ?? 0
  const falseNorthing = param('false_northing') ?? 0
  const unitsMatch = wkt.match(/UNIT\s*\[\s*"[^"]*"\s*,\s*([\d.]+)/g)
  // 最后一个 UNIT 通常是线性单位
  const unitFactor = unitsMatch ? parseFloat(unitsMatch[unitsMatch.length - 1].match(/[\d.]+/)![0]) : 1
  const unit = unitFactor === 0.3048 ? 'ft' : 'm'
  const base = `+proj=longlat +ellps=${ellps} +no_defs +type=crs`
  if (projName === 'Transverse_Mercator' && centralMeridian !== null) {
    return {
      name,
      def: `+proj=tmerc +lat_0=0 +lon_0=${centralMeridian} +k=${scaleFactor} +x_0=${falseEasting} +y_0=${falseNorthing} +ellps=${ellps} +units=${unit} +no_defs +type=crs`,
    }
  }
  if (projName === 'Albers_Conic_Equal_Area') {
    const sp1 = param('standard_parallel_1')
    const sp2 = param('standard_parallel_2')
    const lat0 = param('latitude_of_center') ?? 0
    if (sp1 !== null && sp2 !== null && centralMeridian !== null) {
      return {
        name,
        def: `+proj=aea +lat_0=${lat0} +lon_0=${centralMeridian} +lat_1=${sp1} +lat_2=${sp2} +x_0=${falseEasting} +y_0=${falseNorthing} +ellps=${ellps} +units=${unit} +no_defs +type=crs`,
      }
    }
  }
  if (projName === 'Lambert_Conformal_Conic') {
    const sp1 = param('standard_parallel_1')
    const sp2 = param('standard_parallel_2')
    const lat0 = param('latitude_of_origin') ?? 0
    if (sp1 !== null && centralMeridian !== null) {
      return {
        name,
        def: `+proj=lcc +lat_0=${lat0} +lon_0=${centralMeridian} +lat_1=${sp1} +lat_2=${sp2 ?? sp1} +x_0=${falseEasting} +y_0=${falseNorthing} +ellps=${ellps} +units=${unit} +no_defs +type=crs`,
      }
    }
  }
  if (projName === 'Mercator_1SP' || projName === 'Mercator_2SP') {
    return {
      name,
      def: `+proj=merc +lat_ts=0 +lon_0=${centralMeridian ?? 0} +x_0=${falseEasting} +y_0=${falseNorthing} +ellps=${ellps} +units=${unit} +no_defs +type=crs`,
    }
  }
  return { name, def: base }
}

/**
 * 解析 .prj 文本 → 可用的 EPSG 代码（优先）或 proj4 def。
 * 返回值中的 def 会被自动注册到 proj4。
 */
export function resolvePrj(wkt: string): { code?: string; def?: string; name?: string } {
  const parsed = wktToProj4(wkt)
  if (parsed.code) {
    if (ensureCrsDefined(parsed.code)) return { ...parsed }
    // EPSG 代码未知 → 退回解析 def
  }
  if (parsed.def) {
    try {
      proj4.defs('__custom__', parsed.def)
      proj4('__custom__', 'EPSG:4326', [0, 0]) // 校验定义可用
      return { ...parsed, code: '__custom__' }
    } catch {
      return { name: parsed.name }
    }
  }
  return parsed
}
