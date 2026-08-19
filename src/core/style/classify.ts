/**
 * 数值分级方法（引擎无关）：等距 / 分位数 / 自然间断点（Jenks）。
 * 只产出断点区间，不绑定颜色；配色由 ramps.ts 负责，
 * 组装为渐变符号见 legend.ts 的 graduatedBreaks()。
 */

export type ClassifyMethod = 'equal' | 'quantile' | 'jenks'

export interface ClassBreak {
  min: number
  max: number
}

export const CLASSIFY_METHODS: { id: ClassifyMethod; name: string; hint: string }[] = [
  { id: 'equal', name: '等距分级', hint: '值域均分为 n 档，适合分布均匀的数据' },
  { id: 'quantile', name: '分位数', hint: '每档要素数量相近，适合排名类指标' },
  { id: 'jenks', name: '自然间断点', hint: '组内差异最小、组间差异最大（Jenks 最优分割）' },
]

function sortedFinite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
}

function toBreaks(edges: number[]): ClassBreak[] {
  const out: ClassBreak[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    out.push({ min: edges[i], max: edges[i + 1] })
  }
  return out
}

/** 等距分级（值域均分） */
export function equalIntervalClassBreaks(values: number[], count: number): ClassBreak[] {
  const nums = sortedFinite(values)
  if (nums.length === 0 || count <= 0) return []
  const min = nums[0]
  const max = nums[nums.length - 1]
  if (min === max) return [{ min, max }]
  const n = Math.min(count, nums.length)
  const step = (max - min) / n
  const edges: number[] = []
  for (let i = 0; i <= n; i++) edges.push(i === n ? max : min + i * step)
  return toBreaks(edges)
}

/** 分位数分级（每档样本量相近） */
export function quantileClassBreaks(values: number[], count: number): ClassBreak[] {
  const nums = sortedFinite(values)
  if (nums.length === 0 || count <= 0) return []
  if (nums[0] === nums[nums.length - 1]) return [{ min: nums[0], max: nums[0] }]
  const n = Math.min(count, nums.length)
  const edges: number[] = [nums[0]]
  for (let i = 1; i < n; i++) {
    const idx = Math.floor((i / n) * nums.length)
    edges.push(nums[Math.min(idx, nums.length - 1)])
  }
  edges.push(nums[nums.length - 1])
  // 去除重复边界（大量重复值时可能出现空档）
  const dedup: number[] = [edges[0]]
  for (const e of edges.slice(1)) {
    if (e > dedup[dedup.length - 1]) dedup.push(e)
  }
  if (dedup.length < 2) return [{ min: nums[0], max: nums[nums.length - 1] }]
  return toBreaks(dedup)
}

/**
 * 自然间断点（Jenks optimal，动态规划，O(n²·k)，演示数据规模足够）。
 * 返回使组内方差和最小的 k 档分割。
 */
export function jenksClassBreaks(values: number[], count: number): ClassBreak[] {
  const data = sortedFinite(values)
  const n = data.length
  if (n === 0 || count <= 0) return []
  if (data[0] === data[n - 1]) return [{ min: data[0], max: data[n - 1] }]
  const k = Math.max(1, Math.min(count, n))
  if (k === 1) return [{ min: data[0], max: data[n - 1] }]

  // lower[i][j]：把前 i 个数分为 j 类时，第 j 类起始下标（1 基）
  const lower: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0))
  // variance[i][j]：前 i 个数分 j 类的最小组内方差和
  const variance: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity))
  for (let j = 1; j <= k; j++) {
    lower[1][j] = 1
    variance[1][j] = 0
  }
  for (let i = 2; i <= n; i++) variance[i][1] = Number.MAX_VALUE // 先占位，下方循环计算

  for (let l = 2; l <= n; l++) {
    let sum = 0
    let sumSquares = 0
    let w = 0
    for (let m = 1; m <= l; m++) {
      const lowerClassLimit = l - m + 1
      const val = data[lowerClassLimit - 1]
      w++
      sum += val
      sumSquares += val * val
      const var_ = sumSquares - (sum * sum) / w
      const i4 = lowerClassLimit - 1
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (variance[l][j] >= var_ + variance[i4][j - 1]) {
            lower[l][j] = lowerClassLimit
            variance[l][j] = var_ + variance[i4][j - 1]
          }
        }
      }
    }
    lower[l][1] = 1
    variance[l][1] = sumSquares - (sum * sum) / w
  }

  // 回溯各类的真实取值范围（与 QGIS 显示一致：类间可能留有空隙，
  // 落入空隙的未见值由渲染层走默认色）
  const ranges: ClassBreak[] = []
  let cls = k
  let idx = n
  while (cls > 1) {
    const start = lower[idx][cls] // 1 基：该类第一个元素
    ranges.unshift({ min: data[start - 1], max: data[idx - 1] })
    idx = start - 1
    cls--
  }
  ranges.unshift({ min: data[0], max: data[idx - 1] })
  return ranges
}

/** 按方法分级 */
export function classifyValues(values: number[], count: number, method: ClassifyMethod): ClassBreak[] {
  switch (method) {
    case 'quantile':
      return quantileClassBreaks(values, count)
    case 'jenks':
      return jenksClassBreaks(values, count)
    default:
      return equalIntervalClassBreaks(values, count)
  }
}
