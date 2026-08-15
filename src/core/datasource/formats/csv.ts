/**
 * CSV 解析：首行表头 + 标准 CSV（引号包裹、逗号/制表符自动检测）。
 * 自动识别经纬度列（大小写不敏感、容忍空白），输出 Point 要素（[lon, lat]）。
 */
import type { Feature } from 'geojson'
import type { ParsedVectorData } from '../types'
import { inferLayerMeta } from '@/core/layers/model'

const LON_KEYS = ['lon', 'lng', 'longitude', '经度', 'x']
const LAT_KEYS = ['lat', 'latitude', '纬度', 'y']

function detectDelimiter(firstLine: string): string {
  const comma = (firstLine.match(/,/g) ?? []).length
  const tab = (firstLine.match(/\t/g) ?? []).length
  return tab > comma ? '\t' : ','
}

/** 标准 CSV 分词：支持双引号包裹（含 "" 转义）、CRLF/CR/LF 换行 */
function tokenize(text: string, delim: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (c === '\r') {
      // 仅当后面不是 \n 时视为行结束（CR 换行）
      if (text[i + 1] !== '\n') {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      }
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 列是否全为数字（允许空值；至少一个非空值） */
function isNumericColumn(data: string[][], idx: number): boolean {
  let seen = false
  for (const cells of data) {
    const v = (cells[idx] ?? '').trim()
    if (v === '') continue
    seen = true
    if (!Number.isFinite(parseFloat(v))) return false
  }
  return seen
}

export function parseCsv(text: string, name: string): ParsedVectorData {
  const clean = text.replace(/^\ufeff/, '')
  const firstLine = clean.split('\n')[0] ?? ''
  const rows = tokenize(clean, detectDelimiter(firstLine))

  const emptyResult = (warnings: string[]): ParsedVectorData => ({
    kind: 'vector',
    name,
    format: 'csv',
    features: [],
    fields: [],
    warnings,
  })

  if (rows.length < 2) return emptyResult(['未找到经纬度列'])

  const headers = rows[0].map((h) => h.trim())
  let lonIdx = -1
  let latIdx = -1
  headers.forEach((h, i) => {
    const key = h.toLowerCase()
    if (lonIdx === -1 && LON_KEYS.includes(key)) lonIdx = i
    if (latIdx === -1 && LAT_KEYS.includes(key)) latIdx = i
  })

  // 坐标列必须是数字列
  if (lonIdx !== -1 && !isNumericColumn(rows.slice(1), lonIdx)) lonIdx = -1
  if (latIdx !== -1 && !isNumericColumn(rows.slice(1), latIdx)) latIdx = -1

  if (lonIdx === -1 || latIdx === -1) return emptyResult(['未找到经纬度列'])

  const features: Feature[] = []
  for (const cells of rows.slice(1)) {
    if (cells.length === 0) continue
    const lon = parseFloat(cells[lonIdx] ?? '')
    const lat = parseFloat(cells[latIdx] ?? '')
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
    const properties: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      properties[h] = cells[i] ?? ''
    })
    features.push({
      type: 'Feature',
      properties,
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })
  }

  return {
    kind: 'vector',
    name,
    format: 'csv',
    features,
    fields: inferLayerMeta(features).fields,
    warnings: [],
  }
}
