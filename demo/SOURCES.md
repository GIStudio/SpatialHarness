# demo 数据来源与许可（SOURCES）

本目录 `demo/data/` 收录的均为**轻量级（单个文件 < 2 MB）、许可宽松**的开源/公共领域数据集，
作为 SpatialHarness 的标准 demo 数据。整理脚本：`scripts/prepare_demo_data.mjs`（幂等，自动下载原始数据到 `demo/data/.cache/`，该目录不入库）。

> **⚠️ 中国国境线说明**：凡涉及中国国境的 demo（`china-regions` 场景，以及
> `world-population` / `world-cities` / `earthquakes-week` / `rivers-osm` / `auto-gdp`
> 场景中的中国要素），均采用**中国认可的权威数据**（天地图/国家地理信息公共服务平台
> 数据，经 [chinese-global-compliant-geodata](https://github.com/JayMuShui/chinese-global-compliant-geodata) 打包，MIT）绘制：
> **藏南地区在中国境内**（达旺/错那/隆子/察隅等均在中国国界与西藏省界内）、
> **台湾为中国省级行政区**（不作为独立国家要素）、包含**南海诸岛与九段线**、
> 含钓鱼岛。数据已通过关键点位程序化校验（见下）。

## 文件清单

| 文件 | 内容 | 来源 | 许可 |
|---|---|---|---|
| `ne_110m_admin_0_countries.geojson` | 世界国家面（176 要素，含人口 POP_EST / GDP_MD / 大洲 / 中英文名） | Natural Earth 110m admin0；**中国要素几何替换为天地图源国界**（含藏南/台湾/南海诸岛/钓鱼岛），原 NE 台湾独立要素已并入中国 | 公共领域（NE）+ 天地图数据 |
| `ne_110m_rivers_lake_centerlines.geojson` | 世界主要河流线（13 要素） | Natural Earth 110m | 公共领域 |
| `ne_110m_populated_places.geojson` | 世界主要城市点（243 要素） | Natural Earth 110m | 公共领域 |
| `china_provinces.geojson` | 中国省级行政区（34 个：含台湾省/港澳；藏南在西藏境内） | 天地图源 `chn-level-1`（国家地理信息公共服务平台数据） | MIT（打包方）/ 天地图数据 |
| `china_boundary_lines.geojson` | 中国境界线（8 条：含**南海断续线（九段线）**、未定国界线、特殊边界段） | 天地图源 `chn-level-1` 境界线 | MIT / 天地图数据 |
| `china_south_china_sea.geojson` | 南海诸岛范围面 | 阿里云 DataV.GeoAtlas `100000_full`（100000_JD 要素） | DataV 公开接口（demo 用途） |
| `usgs_earthquakes_m45_week.csv` | 全球近一周 M≥4.5 地震点 | USGS 实时订阅源 | 美国政府作品，公共领域 |
| `parcels_landuse.geojson` | 小区域地块面（手工构造样例） | 本仓库 | 同仓库 MIT |

## 中国国境关键点程序化校验（`prepare_demo_data.mjs` 产出后验证）

| 检查项 | 结果 |
|---|---|
| 藏南：达旺 (91.87E, 27.49N)、错那、隆子、察隅 在中国西藏省界内 | ✅ 均在 |
| 藏南：上述城镇在中国国界（world.json 源）内 | ✅ 均在 |
| 西藏省界按经度带南界：西段 26.85N / 中段 26.88N / 东段 27.74N（三源一致：天地图国界、DataV、chn-level-1） | ✅ 符合中国主张线 |
| 台湾：不作为独立国家要素（NE 中已并入中国），标注"台湾省" | ✅ |
| 南海诸岛 / 钓鱼岛：在中国要素内，单独提供南海诸岛面 + 九段线 | ✅ |
| 世界图中国 bbox 南界 3.40°N（曾母暗沙） | ✅ |

## 复现数据整理

```bash
node scripts/prepare_demo_data.mjs   # 自动下载原始数据到 demo/data/.cache/ 并生成全部文件
```

原始下载地址（脚本内 `REMOTE` 表，幂等）：

- Natural Earth：`raw.githubusercontent.com/nvkelso/natural-earth-vector/.../geojson/ne_110m_*.geojson`
- 中国省界/境界线/国界：`github.com/JayMuShui/chinese-global-compliant-geodata/.../chn-level-1.json`、`.../globe/world.json`
- 南海诸岛：`geo.datav.aliyun.com/areas_v3/bound/100000_full.json`
- USGS：`earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.csv`（实时数据，随时间变化）

## 在线底图来源

应用内在线底图为运行时拉取的公共瓦片服务（不入库）：

| 底图 | 服务 | 版权 |
|---|---|---|
| OpenStreetMap 标准图 | tile.openstreetmap.org | © OpenStreetMap contributors（ODbL） |
| Carto 浅色 / 深色 | basemaps.cartocdn.com | © OpenStreetMap contributors © CARTO |

> 注：在线底图（OSM/Carto）的国界为国际通行画法（藏南在印度侧），与本地中国标准矢量数据
> 叠加时以本地矢量（中国主张）为准。PNG 导出时版权说明会自动附加在图像左下角。
