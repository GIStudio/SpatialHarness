/**
 * demo 数据整理脚本（可重复执行）：
 * - 从 Natural Earth 原始 GeoJSON 中裁剪所需字段、降低坐标精度，控制体积
 * - 中国数据全部改用**中国认可的权威来源**（天地图/国家地理信息公共服务平台，
 *   经 chinese-global-compliant-geodata 打包，MIT）：
 *   · china_provinces.geojson          —— 34 省级行政区（藏南在中国内、含台湾/港澳）
 *   · china_boundary_lines.geojson     —— 国界线/九段线（南海断续线）
 *   · china_south_china_sea.geojson    —— 南海诸岛（阿里云 DataV.GeoAtlas）
 *   · 世界图中中国国界替换为天地图源轮廓（含藏南/台湾/南海诸岛/钓鱼岛）
 *
 * 用法（仓库根目录）：
 *   node scripts/prepare_demo_data.mjs
 * 原始数据自动下载到 demo/data/.cache/（不入库，见 demo/SOURCES.md）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA = path.join(ROOT, 'demo', 'data')
const CACHE = path.join(DATA, '.cache')

const REMOTE = {
  'ne_110m_admin_0_countries.geojson':
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson',
  'ne_110m_rivers_lake_centerlines.geojson':
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_rivers_lake_centerlines.geojson',
  'ne_110m_populated_places.geojson':
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places_simple.geojson',
  'chn-level-1.json':
    'https://raw.githubusercontent.com/JayMuShui/chinese-global-compliant-geodata/main/src/geojson/countries/as/chn/global/chn-level-1.json',
  'world.json':
    'https://raw.githubusercontent.com/JayMuShui/chinese-global-compliant-geodata/main/src/geojson/globe/world.json',
  'datav_100000_full.json': 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
}

/** 下载原始数据到缓存目录（curl 走系统代理；已有缓存则跳过） */
function fetchRemote(name) {
  fs.mkdirSync(CACHE, { recursive: true })
  const dest = path.join(CACHE, name)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest
  const url = REMOTE[name]
  console.log(`↓ 下载 ${name} …`)
  execFileSync('curl', ['-sL', '--retry', '3', '--retry-all-errors', '--max-time', '300', '-o', dest, url])
  return dest
}

/** 递归降低坐标精度（默认 2 位小数 ≈ 1.1km，演示足够） */
function roundCoords(coords, digits) {
  const f = (n) => Number(n.toFixed(digits))
  const walk = (c) => (typeof c[0] === 'number' ? [f(c[0]), f(c[1])] : c.map(walk))
  return walk(coords)
}

function processGeoJSON(input, output, { keepProps, rename = {}, digits = 3 }) {
  const fc = JSON.parse(fs.readFileSync(input, 'utf8'))
  const features = fc.features.map((feat) => {
    const props = {}
    for (const [from, to] of Object.entries(rename)) {
      // 兼容已处理过的文件（rename 目标键已存在），保证脚本幂等
      const v = feat.properties?.[from] ?? feat.properties?.[to]
      if (v !== undefined && v !== null) props[to] = v
    }
    for (const k of keepProps) {
      const v = feat.properties?.[k]
      if (v !== undefined && v !== null && !(k in rename)) props[k] = v
    }
    return {
      type: 'Feature',
      properties: props,
      geometry: feat.geometry
        ? { type: feat.geometry.type, coordinates: roundCoords(feat.geometry.coordinates, digits) }
        : null,
    }
  })
  const out = { type: 'FeatureCollection', features }
  fs.writeFileSync(output, JSON.stringify(out))
  const kb = (fs.statSync(output).size / 1024).toFixed(0)
  console.log(`✓ ${path.basename(output)}  ${features.length} 要素  ${kb} KB`)
}

// ---- 世界国家（110m）：属性裁剪 + 中国国界替换为天地图源轮廓 ----
// 每次从原始数据重建（幂等）：台湾（中国的一部分）用 DataV 台湾省精细几何并入中国，
// 并移除独立台湾要素
{
  const raw = JSON.parse(fs.readFileSync(fetchRemote('ne_110m_admin_0_countries.geojson'), 'utf8'))
  const world = JSON.parse(fs.readFileSync(fetchRemote('world.json'), 'utf8'))
  const datav = JSON.parse(fs.readFileSync(fetchRemote('datav_100000_full.json'), 'utf8'))
  const worldChina = world.features.find((f) => f.properties?.iso_a3 === 'CHN')
  const rawChina = raw.features.find((f) => f.properties?.ISO_A3 === 'CHN')
  const datavTaiwan = datav.features.find((f) => f.properties?.name === '台湾省')
  if (!worldChina || !rawChina) throw new Error('未找到中国要素（world.json / NE）')

  // 天地图源中国轮廓（含藏南/南海诸岛/钓鱼岛）+ DataV 台湾省精细几何（含台湾岛/澎湖/钓鱼岛）
  const chinaRings = worldChina.geometry.type === 'MultiPolygon'
    ? worldChina.geometry.coordinates.map((r) => r)
    : [worldChina.geometry.coordinates]
  if (datavTaiwan) {
    for (const ring of datavTaiwan.geometry.coordinates) {
      chinaRings.push(roundCoords(ring, 2))
    }
  }

  const KEEP = ['POP_EST', 'GDP_MD', 'CONTINENT', 'SUBREGION', 'ECONOMY', 'INCOME_GRP']
  const RENAME = { NAME: 'name', NAME_ZH: 'name_zh', ISO_A3: 'iso_a3' }
  const features = raw.features
    .filter((f) => f.properties?.ISO_A3 !== 'TWN') // 台湾已并入中国
    .map((feat) => {
      const props = {}
      for (const [from, to] of Object.entries(RENAME)) {
        const v = feat.properties?.[from] ?? feat.properties?.[to]
        if (v !== undefined && v !== null) props[to] = v
      }
      for (const k of KEEP) {
        const v = feat.properties?.[k]
        if (v !== undefined && v !== null && !(k in RENAME)) props[k] = v
      }
      const geometry =
        feat.properties?.ISO_A3 === 'CHN' || feat.properties?.iso_a3 === 'CHN'
          ? { type: 'MultiPolygon', coordinates: chinaRings }
          : { type: feat.geometry.type, coordinates: roundCoords(feat.geometry.coordinates, 2) }
      return { type: 'Feature', properties: props, geometry }
    })
  const fc = { type: 'FeatureCollection', features }
  const out = path.join(DATA, 'ne_110m_admin_0_countries.geojson')
  fs.writeFileSync(out, JSON.stringify(fc))
  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`✓ ne_110m_admin_0_countries.geojson（中国国界=天地图源，含藏南/台湾/南海诸岛） ${features.length} 要素  ${kb} KB`)
}

// ---- 世界河流（110m）----
processGeoJSON(
  fetchRemote('ne_110m_rivers_lake_centerlines.geojson'),
  path.join(DATA, 'ne_110m_rivers_lake_centerlines.geojson'),
  { keepProps: ['name', 'name_zh', 'featurecla', 'scalerank'], digits: 3 },
)

// ---- 世界城市（110m populated places）：人口/类别适合点符号化 ----
processGeoJSON(
  fetchRemote('ne_110m_populated_places.geojson'),
  path.join(DATA, 'ne_110m_populated_places.geojson'),
  {
    keepProps: ['name', 'name_zh', 'featurecla', 'pop_max', 'megacity', 'adm0name', 'worldcity'],
    digits: 3,
  },
)

// ============ 中国标准数据（中国认可来源） ============

/** 省级行政区 → 六大地理分区（中国地图惯例） */
const PROVINCE_REGION = {
  北京: '华北', 天津: '华北', 河北: '华北', 山西: '华北', 内蒙古: '华北',
  辽宁: '东北', 吉林: '东北', 黑龙江: '东北',
  上海: '华东', 江苏: '华东', 浙江: '华东', 安徽: '华东', 福建: '华东', 江西: '华东', 山东: '华东', 台湾: '华东',
  河南: '中南', 湖北: '中南', 湖南: '中南', 广东: '中南', 广西: '中南', 海南: '中南', 香港: '中南', 澳门: '中南',
  重庆: '西南', 四川: '西南', 贵州: '西南', 云南: '西南', 西藏: '西南',
  陕西: '西北', 甘肃: '西北', 青海: '西北', 宁夏: '西北', 新疆: '西北',
}

// ---- 中国省级行政区（天地图源 chn-level-1：含藏南、台湾、港澳） ----
{
  const src = JSON.parse(fs.readFileSync(fetchRemote('chn-level-1.json'), 'utf8'))
  const provinces = src.features.filter((f) => f.properties.name !== '境界线')
  const features = provinces.map((f) => {
    const name = f.properties.name
    const region = PROVINCE_REGION[name] ?? '其他'
    return {
      type: 'Feature',
      properties: {
        name,
        name_zh: f.properties.full_name ?? name,
        gb: f.properties.gb ?? '',
        region,
        region_zh: region,
      },
      geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates, 3) },
    }
  })
  // 排序稳定：按 GB 码（华北→华南 大致方位顺序），缺失放最后
  features.sort((a, b) => (a.properties.gb || 'z').localeCompare(b.properties.gb || 'z'))
  const fc = { type: 'FeatureCollection', features }
  const out = path.join(DATA, 'china_provinces.geojson')
  fs.writeFileSync(out, JSON.stringify(fc))
  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`✓ china_provinces.geojson（天地图源） ${features.length} 要素  ${kb} KB`)
}

// ---- 中国境界线（含九段线/南海断续线） ----
{
  const src = JSON.parse(fs.readFileSync(fetchRemote('chn-level-1.json'), 'utf8'))
  const lines = src.features.filter((f) => f.properties.name === '境界线')
  const features = lines.map((f, i) => ({
    type: 'Feature',
    properties: {
      name: f.properties.name,
      kind: i === 6 ? 'nine-dash' : i === 2 ? 'undetermined' : 'other',
      kind_zh:
        i === 6 ? '南海断续线（九段线）' : i === 2 ? '未定国界线' : '边界线（特殊段）',
    },
    geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates, 3) },
  }))
  const fc = { type: 'FeatureCollection', features }
  const out = path.join(DATA, 'china_boundary_lines.geojson')
  fs.writeFileSync(out, JSON.stringify(fc))
  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`✓ china_boundary_lines.geojson（含九段线） ${features.length} 要素  ${kb} KB`)
}

// ---- 南海诸岛（DataV.GeoAtlas 100000_JD，中国标准地图附岛） ----
{
  const src = JSON.parse(fs.readFileSync(fetchRemote('datav_100000_full.json'), 'utf8'))
  const jd = src.features.find((f) => String(f.properties.adcode ?? '').endsWith('_JD'))
  if (!jd) throw new Error('DataV 数据中未找到南海诸岛要素')
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '南海诸岛', name_zh: '南海诸岛' },
        geometry: { type: jd.geometry.type, coordinates: roundCoords(jd.geometry.coordinates, 3) },
      },
    ],
  }
  const out = path.join(DATA, 'china_south_china_sea.geojson')
  fs.writeFileSync(out, JSON.stringify(fc))
  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`✓ china_south_china_sea.geojson（南海诸岛） ${kb} KB`)
}
