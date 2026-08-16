/**
 * 矢量导出：geojson（美化 JSON）/ csv（点 → lon,lat 列；线/面 → WKT）/ kml（最小 KML 2.2）/
 * shp（Shapefile 五件套打包 .zip，UTF-8 属性）。
 * 均为纯字符串/字节构造，可在 Web Worker 中执行。
 */
import type { Feature, Geometry, Position } from 'geojson'
import type { ExportRequest, ExportResult } from './types'
import { buildShapefileZip, sanitizeFileStem, writeShapefileParts } from './formats/shpWrite'

/* ------------------------------ WKT（坐标 'x y' 空格分隔，环闭合，不含 Z） ------------------------------ */

function pair(p: Position): string {
  return `${p[0]} ${p[1]}`
}

function ringCoords(r: Position[]): string {
  const closed =
    r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]
  return `(${closed.map(pair).join(', ')})`
}

export function geometryToWkt(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return `POINT (${pair(g.coordinates)})`
    case 'MultiPoint':
      return `MULTIPOINT (${g.coordinates.map((p) => `(${pair(p)})`).join(', ')})`
    case 'LineString':
      return `LINESTRING (${g.coordinates.map(pair).join(', ')})`
    case 'MultiLineString':
      return `MULTILINESTRING (${g.coordinates.map((l) => `(${l.map(pair).join(', ')})`).join(', ')})`
    case 'Polygon':
      return `POLYGON (${g.coordinates.map(ringCoords).join(', ')})`
    case 'MultiPolygon':
      return `MULTIPOLYGON (${g.coordinates.map((poly) => `(${poly.map(ringCoords).join(', ')})`).join(', ')})`
    case 'GeometryCollection':
      return `GEOMETRYCOLLECTION (${g.geometries.map(geometryToWkt).join(', ')})`
    default:
      return ''
  }
}

/* ------------------------------ CSV ------------------------------ */

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function firstLonLat(g: Geometry | null): [string, string] {
  if (!g) return ['', '']
  let p: Position | null = null
  if (g.type === 'Point') p = g.coordinates
  else if (g.type === 'MultiPoint') p = g.coordinates[0] ?? null
  else if (g.type === 'LineString') p = g.coordinates[0] ?? null
  else if (g.type === 'MultiLineString') p = g.coordinates[0]?.[0] ?? null
  else if (g.type === 'Polygon') p = g.coordinates[0]?.[0] ?? null
  else if (g.type === 'MultiPolygon') p = g.coordinates[0]?.[0]?.[0] ?? null
  else if (g.type === 'GeometryCollection') {
    for (const sub of g.geometries) {
      const [x, y] = firstLonLat(sub)
      if (x !== '' || y !== '') return [x, y]
    }
  }
  return p ? [String(p[0]), String(p[1])] : ['', '']
}

function isPointLike(g: Geometry | null): boolean {
  return g !== null && (g.type === 'Point' || g.type === 'MultiPoint')
}

function exportCsv(features: Feature[], layerName: string): ExportResult {
  const fields: string[] = []
  for (const f of features) {
    for (const k of Object.keys(f.properties ?? {})) {
      if (!fields.includes(k)) fields.push(k)
    }
  }
  const pointLayer = features.every((f) => isPointLike(f.geometry))
  const header = pointLayer ? [...fields, 'lon', 'lat'] : [...fields, 'WKT']
  const lines = [header.map(csvCell).join(',')]
  for (const f of features) {
    const values = fields.map((k) => (f.properties?.[k] ?? '') as unknown)
    if (pointLayer) {
      const [lon, lat] = firstLonLat(f.geometry)
      lines.push([...values.map(csvCell), lon, lat].join(','))
    } else {
      lines.push([...values.map(csvCell), f.geometry ? geometryToWkt(f.geometry) : ''].join(','))
    }
  }
  return {
    blob: new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
    fileName: `${layerName}.csv`,
  }
}

/* ------------------------------ KML ------------------------------ */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function kmlCoords(positions: Position[]): string {
  return positions.map((p) => `${p[0]},${p[1]}`).join(' ')
}

function polygonXml(rings: Position[][]): string {
  const ringXml = rings.map((r) => {
    const closed =
      r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r : [...r, r[0]]
    return `<LinearRing><coordinates>${kmlCoords(closed)}</coordinates></LinearRing>`
  })
  const outer = ringXml[0] ? `<outerBoundaryIs>${ringXml[0]}</outerBoundaryIs>` : ''
  const inner = ringXml
    .slice(1)
    .map((r) => `<innerBoundaryIs>${r}</innerBoundaryIs>`)
    .join('')
  return `<Polygon>${outer}${inner}</Polygon>`
}

function kmlGeometry(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return `<Point><coordinates>${kmlCoords([g.coordinates])}</coordinates></Point>`
    case 'MultiPoint':
      return `<MultiGeometry>${g.coordinates
        .map((p) => `<Point><coordinates>${p[0]},${p[1]}</coordinates></Point>`)
        .join('')}</MultiGeometry>`
    case 'LineString':
      return `<LineString><coordinates>${kmlCoords(g.coordinates)}</coordinates></LineString>`
    case 'MultiLineString':
      return `<MultiGeometry>${g.coordinates
        .map((l) => `<LineString><coordinates>${kmlCoords(l)}</coordinates></LineString>`)
        .join('')}</MultiGeometry>`
    case 'Polygon':
      return polygonXml(g.coordinates)
    case 'MultiPolygon':
      return `<MultiGeometry>${g.coordinates.map(polygonXml).join('')}</MultiGeometry>`
    case 'GeometryCollection':
      return `<MultiGeometry>${g.geometries.map(kmlGeometry).join('')}</MultiGeometry>`
    default:
      return ''
  }
}

function exportKml(features: Feature[], layerName: string): ExportResult {
  const placemarks = features
    .filter((f) => f.geometry)
    .map((f, i) => {
      const props = (f.properties ?? {}) as Record<string, unknown>
      const rawName = props.name ?? props.NAME ?? props.title
      const fname = rawName !== undefined && rawName !== null ? String(rawName) : `要素 ${i + 1}`
      const data = Object.entries(props)
        .map(([k, v]) => `<Data name="${xmlEscape(k)}"><value>${xmlEscape(String(v ?? ''))}</value></Data>`)
        .join('')
      return `<Placemark><name>${xmlEscape(fname)}</name><ExtendedData>${data}</ExtendedData>${kmlGeometry(f.geometry!)}</Placemark>`
    })
    .join('')
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(layerName)}</name>${placemarks}</Document></kml>`
  return {
    blob: new Blob([xml], { type: 'application/vnd.google-earth.kml+xml' }),
    fileName: `${layerName}.kml`,
  }
}

/* ------------------------------ Shapefile ------------------------------ */

function exportShp(features: Feature[], layerName: string): ExportResult {
  const stem = sanitizeFileStem(layerName)
  const parts = writeShapefileParts(features)
  const zip = buildShapefileZip(parts, stem)
  return {
    blob: new Blob([zip], { type: 'application/zip' }),
    fileName: `${stem}.zip`,
    warnings: parts.warnings,
  }
}

/* ------------------------------ 入口 ------------------------------ */

export function exportVector(req: ExportRequest): ExportResult {
  const { features, format } = req
  const layerName = sanitizeFileStem(req.layerName)
  if (format === 'geojson') {
    const json = JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
    return {
      blob: new Blob([json], { type: 'application/geo+json' }),
      fileName: `${layerName}.geojson`,
    }
  }
  if (format === 'csv') return exportCsv(features, layerName)
  if (format === 'shp') return exportShp(features, layerName)
  return exportKml(features, layerName)
}
