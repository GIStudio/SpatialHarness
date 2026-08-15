/**
 * 文件 → ParseResult 的调度层（Web Worker 内执行）。
 * 按扩展名分组：shapefile 系列（.shp/.dbf/.shx/.prj）按主干名合并为一个图层；
 * 每个文件单独捕获异常，失败不中断其他文件，错误信息记入 warnings。
 * 约定：文件级全局 warning（不支持类型/跳过组/解析失败）挂到第一个结果上。
 */
import type { Feature } from 'geojson'
import type { ImportFile, ParseResult, SupportedFormat } from './types'
import shp from 'shpjs'
import { inferLayerMeta } from '@/core/layers/model'
import { parseGeoJson } from './formats/geojson'
import { parseShapefile } from './formats/shp'
import { parseKml, parseGpx } from './formats/kml'
import { parseCsv } from './formats/csv'
import { parseGeoTiff } from './formats/geotiff'

const SHAPE_EXT = new Set(['shp', 'dbf', 'shx', 'prj'])
const RASTER_EXT = new Set(['tif', 'tiff', 'gtiff'])

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

function stemOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? name : name.slice(0, i)
}

const decodeText = (buffer: ArrayBuffer): string => new TextDecoder().decode(buffer)

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function parseFiles(files: ImportFile[]): Promise<ParseResult[]> {
  const results: ParseResult[] = []
  const globalWarnings: string[] = []

  // 按扩展名分组
  const shpGroups = new Map<string, ImportFile[]>()
  const zipFiles: ImportFile[] = []
  const singles: { file: ImportFile; fmt: SupportedFormat }[] = []
  for (const file of files) {
    const ext = extOf(file.name)
    if (SHAPE_EXT.has(ext)) {
      const stem = stemOf(file.name)
      const group = shpGroups.get(stem) ?? []
      group.push(file)
      shpGroups.set(stem, group)
    } else if (ext === 'geojson' || ext === 'json') {
      singles.push({ file, fmt: 'geojson' })
    } else if (ext === 'kml') {
      singles.push({ file, fmt: 'kml' })
    } else if (ext === 'gpx') {
      singles.push({ file, fmt: 'gpx' })
    } else if (RASTER_EXT.has(ext)) {
      singles.push({ file, fmt: 'geotiff' })
    } else if (ext === 'csv') {
      singles.push({ file, fmt: 'csv' })
    } else if (ext === 'zip') {
      zipFiles.push(file)
    } else {
      globalWarnings.push(`不支持的文件类型：${file.name}`)
    }
  }

  // 处理单文件格式
  for (const { file, fmt } of singles) {
    try {
      const name = stemOf(file.name)
      if (fmt === 'geojson') results.push(parseGeoJson(decodeText(file.buffer), name))
      else if (fmt === 'kml') results.push(parseKml(decodeText(file.buffer), name))
      else if (fmt === 'gpx') results.push(parseGpx(decodeText(file.buffer), name))
      else if (fmt === 'csv') results.push(parseCsv(decodeText(file.buffer), name))
      else if (fmt === 'geotiff') results.push(await parseGeoTiff(file.buffer, name))
    } catch (err) {
      globalWarnings.push(`${file.name}: ${errMsg(err)}`)
    }
  }

  // 处理 shapefile 压缩包（.zip，可含多个图层；shpjs 内部处理 prj 坐标系）
  for (const file of zipFiles) {
    try {
      const parsed = await shp(file.buffer)
      const list: { features: Feature[]; fileName?: string }[] = Array.isArray(parsed) ? parsed : [parsed]
      for (const fc of list) {
        const layerName = fc.fileName ?? stemOf(file.name)
        const { fields } = inferLayerMeta(fc.features)
        results.push({
          kind: 'vector',
          name: layerName,
          format: 'shp',
          features: fc.features,
          fields,
          warnings: [],
        })
      }
    } catch (err) {
      globalWarnings.push(`${file.name}: ${errMsg(err)}`)
    }
  }

  // 处理 shapefile 组（.shp 与同名 .dbf/.prj 合并为一个图层）
  for (const [stem, group] of shpGroups) {
    if (!group.some((f) => extOf(f.name) === 'shp')) {
      globalWarnings.push(`${stem}: 缺少 .shp 文件，已跳过`)
      continue
    }
    try {
      results.push(await parseShapefile(group, stem))
    } catch (err) {
      globalWarnings.push(`${stem}.shp: ${errMsg(err)}`)
    }
  }

  // 全局 warning 挂到第一个结果上（类型契约中无独立 warning 通道）
  if (results.length > 0 && globalWarnings.length > 0) {
    results[0].warnings.push(...globalWarnings)
  }

  results.sort((a, b) => a.name.localeCompare(b.name))
  return results
}
