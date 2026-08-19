/**
 * 标准 demo 场景注册表（引擎无关）。
 * 每个场景 = 数据文件（demo/data/）+ 自动符号化配置 + 底图 + 初始视图。
 * 样式不硬编码颜色：由 core/style/legend.ts 按数据实时生成（自动制图）。
 */
import type { BasemapId } from '@/core/engine/types'
import type { LabelSpec, LayerStyle } from '@/core/style/types'
import type { ClassifyMethod } from '@/core/style/classify'

export interface DemoLayerDef {
  /** demo/data/ 下的文件名（GeoJSON 或 CSV） */
  file: string
  /** 图层显示名 */
  name: string
  /** 固定样式（与 auto 二选一，优先） */
  style?: LayerStyle
  /** 自动符号化配置（加载时按数据生成样式） */
  auto?: {
    field?: string
    kind?: 'auto' | 'categorized' | 'graduated'
    method?: ClassifyMethod
    classes?: number
    ramp?: string
    invert?: boolean
    maxCategories?: number
  }
  /** 标注 */
  label?: LabelSpec
  opacity?: number
}

export interface DemoScenario {
  id: string
  title: string
  description: string
  /** 案例标签：可视化 / 自动制图 / 在线底图 / 数据格式 等 */
  tags: string[]
  basemap: BasemapId
  /** 初始视图（EPSG:4326 经纬度 + 缩放级别）；缺省时缩放到图层范围 */
  view?: { center: [number, number]; zoom: number }
  /** 用于 PNG 导出 demo 的推荐图题 */
  exportTitle?: string
  layers: DemoLayerDef[]
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: 'world-population',
    title: '世界人口分布图',
    description: '国家面要素按人口自然间断点分级设色（Jenks + 黄-橙-红色带），自动生成图例。',
    tags: ['可视化', '自动制图', '分级设色'],
    basemap: 'carto-light',
    view: { center: [10, 25], zoom: 2 },
    exportTitle: '世界人口分布图',
    layers: [
      {
        file: 'ne_110m_admin_0_countries.geojson',
        name: '世界各国（人口）',
        auto: { field: 'POP_EST', method: 'jenks', classes: 6, ramp: 'yl-or-rd' },
      },
    ],
  },
  {
    id: 'china-regions',
    title: '中国省级行政区（按中国标准地图）',
    description:
      '省界数据采用天地图（国家地理信息公共服务平台）源，藏南在中国境内、含台湾/港澳；叠加南海诸岛与九段线。分区自动配色 + 中文标注。',
    tags: ['可视化', '自动制图', '分类符号', '标注', '中国标准地图'],
    basemap: 'carto-light',
    view: { center: [105, 36], zoom: 3.5 },
    exportTitle: '中国省级行政区图（按中国标准地图）',
    layers: [
      // z 序：南海诸岛垫底（其范围面北至台湾海峡，避免盖住台湾岛/省界上色）
      {
        file: 'china_south_china_sea.geojson',
        name: '南海诸岛',
        style: {
          symbol: { kind: 'simple', fillColor: 'rgba(30,158,130,0.22)', strokeColor: '#1f9e89', strokeWidth: 1 },
          label: null,
        },
      },
      {
        file: 'china_provinces.geojson',
        name: '中国省级行政区',
        auto: { field: 'region_zh', kind: 'categorized', ramp: 'okabe-ito' },
        label: { field: 'name_zh', size: 11, color: '#1f2937' },
      },
      {
        file: 'china_boundary_lines.geojson',
        name: '中国国界线（含九段线）',
        style: {
          symbol: { kind: 'simple', strokeColor: '#b91c1c', strokeWidth: 1.2, strokeDash: [6, 4] },
          label: null,
        },
      },
    ],
  },
  {
    id: 'world-cities',
    title: '世界主要城市分布',
    description: '城市点要素按类别（首都/省会/特大城市等）分类配色，深色在线底图衬托。',
    tags: ['可视化', '分类符号', '在线底图'],
    basemap: 'carto-dark',
    view: { center: [10, 30], zoom: 2 },
    exportTitle: '世界主要城市分布图',
    layers: [
      {
        file: 'ne_110m_populated_places.geojson',
        name: '世界主要城市',
        auto: { field: 'featurecla', kind: 'categorized', ramp: 'bold' },
      },
    ],
  },
  {
    id: 'earthquakes-week',
    title: '全球地震一周监测',
    description: 'USGS 实时 CSV（经度/纬度列自动识别）按震级分位数分级，演示 CSV 直接成图。',
    tags: ['可视化', '自动制图', 'CSV', '点数据'],
    basemap: 'carto-dark',
    view: { center: [150, 15], zoom: 2 },
    exportTitle: '全球地震一周监测图（M≥4.5）',
    layers: [
      {
        file: 'usgs_earthquakes_m45_week.csv',
        name: '地震（近一周 M≥4.5）',
        auto: { field: 'mag', method: 'jenks', classes: 5, ramp: 'reds' },
      },
    ],
  },
  {
    id: 'rivers-osm',
    title: '世界河流与国家轮廓（OSM 在线底图）',
    description: '河流线要素 + 国家面轮廓叠加 OpenStreetMap 在线瓦片底图，演示底图切换。',
    tags: ['在线底图', '线要素', '可视化'],
    basemap: 'osm',
    view: { center: [10, 25], zoom: 2 },
    exportTitle: '世界主要河流分布图',
    layers: [
      {
        file: 'ne_110m_admin_0_countries.geojson',
        name: '国家轮廓',
        style: {
          symbol: { kind: 'simple', fillColor: 'rgba(148,163,184,0.15)', strokeColor: '#94a3b8', strokeWidth: 1 },
          label: null,
        },
      },
      {
        file: 'ne_110m_rivers_lake_centerlines.geojson',
        name: '主要河流',
        style: { symbol: { kind: 'simple', strokeColor: '#2563eb', strokeWidth: 1.5 }, label: null },
      },
    ],
  },
  {
    id: 'parcels-landuse',
    title: '地块土地利用样例',
    description: '小区域地块面要素按土地利用类型自动分类配色 + 名称标注（演示小尺度数据）。',
    tags: ['可视化', '自动制图', '分类符号', '标注'],
    basemap: 'carto-light',
    exportTitle: '地块土地利用图',
    layers: [
      {
        file: 'parcels_landuse.geojson',
        name: '地块（土地利用）',
        auto: { field: 'landuse', kind: 'categorized', ramp: 'okabe-ito' },
        label: { field: 'name', size: 12, color: '#111827' },
      },
    ],
  },
  {
    id: 'auto-gdp',
    title: '自动制图：一键符号化',
    description: '不指定字段，由引擎自动挑选信息量最大的字段并选择符号类型（本例自动命中 GDP 渐变）。',
    tags: ['自动制图'],
    basemap: 'carto-light',
    view: { center: [10, 25], zoom: 2 },
    exportTitle: '世界各国 GDP 自动制图',
    layers: [
      {
        file: 'ne_110m_admin_0_countries.geojson',
        name: '世界各国（自动符号化）',
        auto: { ramp: 'viridis', method: 'jenks', classes: 6 },
      },
    ],
  },
]

export function getDemoScenario(id: string): DemoScenario | null {
  return DEMO_SCENARIOS.find((s) => s.id === id) ?? null
}
