/**
 * KML / GPX 解析：@tmcw/togeojson 接受 DOM Document（由 @xmldom/xmldom 构造）。
 * 图层名直接取调用方传入的 name（文件主干名）。
 */
import { gpx, kml } from '@tmcw/togeojson'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { ParsedVectorData } from '../types'
import { parseXml } from './xml'
import { inferLayerMeta } from '@/core/layers/model'

function fromCollection(fmt: 'kml' | 'gpx', name: string, fc: FeatureCollection<Geometry | null>): ParsedVectorData {
  const warnings: string[] = []
  if (fc.features.length === 0) {
    warnings.push(fmt === 'kml' ? 'KML 中未找到要素' : 'GPX 中未找到要素')
  }
  // togeojson 的要素几何可为 null（KML 中无几何的 Placemark），运行时其余层已兼容
  const features = fc.features as Feature[]
  return {
    kind: 'vector',
    name,
    format: fmt,
    features,
    fields: inferLayerMeta(features).fields,
    warnings,
  }
}

export function parseKml(text: string, name: string): ParsedVectorData {
  const doc = parseXml(text)
  // @xmldom/xmldom 的 Document 与 lib.dom 的 Document 结构兼容，类型上需转换
  const fc = kml(doc as unknown as globalThis.Document)
  return fromCollection('kml', name, fc)
}

export function parseGpx(text: string, name: string): ParsedVectorData {
  const doc = parseXml(text)
  const fc = gpx(doc as unknown as globalThis.Document)
  return fromCollection('gpx', name, fc)
}
