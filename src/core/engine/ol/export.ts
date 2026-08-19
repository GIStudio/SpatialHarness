/**
 * PNG 导出（OpenLayers 适配层）：等待渲染完成 → 合成所有图层画布 →
 * 叠加图题 / 图例 / 版权信息 → 输出 PNG Blob。
 * 画布被跨域内容污染时抛出友好错误。
 */
import type OlMap from 'ol/Map'
import type { ExportLegendGroup, ExportPngOptions } from '../types'

const FONT_FAMILY = '"PingFang SC", "Microsoft YaHei", sans-serif'

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('PNG 编码失败'))
      }, 'image/png')
    } catch {
      reject(new Error('导出失败：地图画布被跨域内容污染（底图需支持 CORS）'))
    }
  })
}

/** 合成地图视口的全部画布（OL 每个图层一个 canvas） */
function composeMapCanvas(map: OlMap, scale: number): HTMLCanvasElement | null {
  const size = map.getSize()
  if (!size) return null
  const out = document.createElement('canvas')
  out.width = Math.round(size[0] * scale)
  out.height = Math.round(size[1] * scale)
  const ctx = out.getContext('2d')
  if (!ctx) return null
  // 白底（无瓦片区域透明时导出为白色而不是黑色）
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)

  const canvases = map.getViewport().querySelectorAll<HTMLCanvasElement>('.ol-layer canvas, canvas.ol-layer')
  canvases.forEach((canvas) => {
    if (canvas.width === 0) return
    const parent = canvas.parentElement
    const opacity = parent ? Number.parseFloat(parent.style.opacity || '1') || 1 : 1
    ctx.globalAlpha = opacity
    const transform = canvas.style.transform
    if (transform.startsWith('matrix')) {
      const m = /^matrix\(([^)]*)\)$/.exec(transform)?.[1].split(',').map(Number)
      if (m && m.length === 6) ctx.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale, m[5] * scale)
      else ctx.setTransform(scale, 0, 0, scale, 0, 0)
    } else {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
    }
    ctx.drawImage(canvas, 0, 0)
  })
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  return out
}

// ---------------- 制图要素绘制（图题 / 图例 / 版权） ----------------

interface BoxMetrics {
  width: number
  height: number
}

function measureLegend(ctx: CanvasRenderingContext2D, groups: ExportLegendGroup[], u: number): BoxMetrics {
  let width = 0
  let height = 10 * u // 上下内边距
  for (const g of groups) {
    height += 18 * u // 图层名
    for (const item of g.items) {
      ctx.font = `${11 * u}px ${FONT_FAMILY}`
      const w = ctx.measureText(item.label).width
      width = Math.max(width, w)
      height += 16 * u
    }
    height += 4 * u
  }
  ctx.font = `bold ${12 * u}px ${FONT_FAMILY}`
  for (const g of groups) width = Math.max(width, ctx.measureText(g.layerName).width)
  return { width: width + 40 * u, height }
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  groups: ExportLegendGroup[],
  canvas: HTMLCanvasElement,
  u: number,
): void {
  const metrics = measureLegend(ctx, groups, u)
  const x = canvas.width - metrics.width - 12 * u
  const y = canvas.height - metrics.height - 12 * u
  // 半透明底框
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = u
  roundRect(ctx, x, y, metrics.width, metrics.height, 4 * u)
  ctx.fill()
  ctx.stroke()

  let cy = y + 6 * u
  for (const g of groups) {
    cy += 13 * u
    ctx.fillStyle = '#111827'
    ctx.font = `bold ${12 * u}px ${FONT_FAMILY}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(g.layerName, x + 8 * u, cy)
    cy += 5 * u
    ctx.font = `${11 * u}px ${FONT_FAMILY}`
    for (const item of g.items) {
      cy += 8 * u
      drawSwatch(ctx, x + 10 * u, cy, 10 * u, item.kind, item.color)
      ctx.fillStyle = '#374151'
      ctx.fillText(item.label, x + 26 * u, cy)
      cy += 8 * u
    }
  }
}

function drawSwatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  s: number,
  kind: 'point' | 'line' | 'polygon',
  color: string,
): void {
  ctx.save()
  if (kind === 'point') {
    ctx.beginPath()
    ctx.arc(x + s / 2, cy, s / 2.4, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = s / 10
    ctx.stroke()
  } else if (kind === 'line') {
    ctx.beginPath()
    ctx.moveTo(x, cy)
    ctx.lineTo(x + s, cy)
    ctx.strokeStyle = color
    ctx.lineWidth = s / 4
    ctx.stroke()
  } else {
    ctx.fillStyle = color
    ctx.fillRect(x, cy - s / 2, s, s)
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = s / 10
    ctx.strokeRect(x, cy - s / 2, s, s)
  }
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawTitle(ctx: CanvasRenderingContext2D, title: string, _canvas: HTMLCanvasElement, u: number): void {
  ctx.font = `bold ${16 * u}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const w = ctx.measureText(title).width
  const x = 12 * u
  const y = 10 * u
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  roundRect(ctx, x - 6 * u, y - 5 * u, w + 12 * u, 26 * u, 4 * u)
  ctx.fill()
  ctx.fillStyle = '#111827'
  ctx.fillText(title, x, y)
}

function drawAttribution(ctx: CanvasRenderingContext2D, text: string, canvas: HTMLCanvasElement, u: number): void {
  ctx.font = `${10 * u}px ${FONT_FAMILY}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  const x = 6 * u
  const y = canvas.height - 5 * u
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  const w = ctx.measureText(text).width
  ctx.fillRect(x - 3 * u, y - 13 * u, w + 6 * u, 15 * u)
  ctx.fillStyle = '#4b5563'
  ctx.fillText(text, x, y)
}

/** 等待一次完整渲染后导出 PNG */
export function exportMapPng(map: OlMap, options: ExportPngOptions = {}): Promise<Blob> {
  const scale = options.scale === 2 ? 2 : 1
  return new Promise<Blob>((resolve, reject) => {
    map.once('rendercomplete', () => {
      void (async () => {
        try {
          const canvas = composeMapCanvas(map, scale)
          if (!canvas) throw new Error('地图尚未挂载')
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('无法创建导出画布')
          if (options.title) drawTitle(ctx, options.title, canvas, scale)
          const legends = (options.legends ?? []).filter((g) => g.items.length > 0)
          if (legends.length > 0) drawLegend(ctx, legends, canvas, scale)
          if (options.attribution) drawAttribution(ctx, options.attribution, canvas, scale)
          resolve(await canvasToBlob(canvas))
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)))
        }
      })()
    })
    map.renderSync()
  })
}
