/**
 * XML → DOM Document（@xmldom/xmldom，可在 Web Worker 中运行，不依赖浏览器 DOMParser）。
 */
import { DOMParser, type Document } from '@xmldom/xmldom'

export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml')
}
