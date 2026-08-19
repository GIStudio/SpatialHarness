/**
 * 制图色带库（引擎无关）：顺序型 / 发散型 / 定性型。
 * 配色取自公开领域方案（ColorBrewer / Viridis / Okabe-Ito），
 * 支持任意档数插值与反转，供分类符号、渐变符号与图例共用。
 */

export type RampType = 'sequential' | 'diverging' | 'qualitative'

export interface ColorRamp {
  id: string
  /** 中文显示名 */
  name: string
  type: RampType
  /** 由浅到深（顺序型）/ 由负到正（发散型）/ 无序（定性型） */
  colors: string[]
}

export const COLOR_RAMPS: ColorRamp[] = [
  // ---- 顺序型（ColorBrewer 9 级） ----
  {
    id: 'blues',
    name: '蓝（顺序）',
    type: 'sequential',
    colors: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  },
  {
    id: 'greens',
    name: '绿（顺序）',
    type: 'sequential',
    colors: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
  },
  {
    id: 'oranges',
    name: '橙（顺序）',
    type: 'sequential',
    colors: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
  },
  {
    id: 'reds',
    name: '红（顺序）',
    type: 'sequential',
    colors: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
  },
  {
    id: 'purples',
    name: '紫（顺序）',
    type: 'sequential',
    colors: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
  },
  {
    id: 'yl-or-rd',
    name: '黄-橙-红（顺序）',
    type: 'sequential',
    colors: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
  },
  // ---- 感知均匀 ----
  {
    id: 'viridis',
    name: 'Viridis（感知均匀）',
    type: 'sequential',
    colors: ['#440154', '#482878', '#3f4788', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  },
  // ---- 发散型（中间为中性色） ----
  {
    id: 'rd-bu',
    name: '红-蓝（发散）',
    type: 'diverging',
    colors: ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
  },
  {
    id: 'rd-yl-gn',
    name: '红-黄-绿（发散）',
    type: 'diverging',
    colors: ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'],
  },
  {
    id: 'pi-yg',
    name: '粉-绿（发散）',
    type: 'diverging',
    colors: ['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#fde0ef', '#e6f5d0', '#b8e186', '#7fbc41', '#4d9221'],
  },
  {
    id: 'spectral',
    name: '光谱（发散）',
    type: 'diverging',
    colors: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#e6f598', '#abdda4', '#66c2a5', '#3288bd'],
  },
  // ---- 定性型（分类配色） ----
  {
    id: 'okabe-ito',
    name: '色盲友好（定性）',
    type: 'qualitative',
    colors: ['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999'],
  },
  {
    id: 'pastel',
    name: '柔和（定性）',
    type: 'qualitative',
    colors: ['#b3e2cd', '#fdcdac', '#cbd5e8', '#f4cae4', '#e6f5c9', '#fff2ae', '#f1e2cc', '#cccccc'],
  },
  {
    id: 'bold',
    name: '高饱和（定性）',
    type: 'qualitative',
    colors: ['#7fc97f', '#beaed4', '#fdc086', '#ffff99', '#386cb0', '#f0027f', '#bf5b17', '#666666'],
  },
]

export function getRamp(id: string): ColorRamp {
  return COLOR_RAMPS.find((r) => r.id === id) ?? COLOR_RAMPS[0]
}

export function rampsOfType(type: RampType): ColorRamp[] {
  return COLOR_RAMPS.filter((r) => r.type === type)
}

/** hex → [r,g,b] */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const num = parseInt(h, 16)
  if (Number.isNaN(num)) return [128, 128, 128]
  return [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff]
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** RGB 线性插值（演示级精度足够；如需感知均匀可在 Lab 空间插值） */
export function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

/**
 * 从色带取 n 个颜色：
 * - n === 1：取中段色（顺序型取最深，发散型取中点）
 * - 顺序/发散型：沿整条色带等距采样插值
 * - 定性型：n ≤ 色带长度时取前 n 色；超过时循环插值
 */
export function rampColors(rampId: string, count: number, invert = false): string[] {
  if (count <= 0) return []
  const ramp = getRamp(rampId)
  let base = ramp.colors
  if (invert) base = [...base].reverse()

  if (ramp.type === 'qualitative') {
    const out: string[] = []
    for (let i = 0; i < count; i++) out.push(base[i % base.length])
    return out
  }

  if (count === 1) {
    // 顺序型单档取最深色更有辨识度；发散型取中点
    return [ramp.type === 'sequential' ? base[base.length - 1] : base[Math.floor(base.length / 2)]]
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const pos = t * (base.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.min(base.length - 1, lo + 1)
    out.push(lerpColor(base[lo], base[hi], pos - lo))
  }
  return out
}
