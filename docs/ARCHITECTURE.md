# SpatialHarness 架构设计

> 纯本地 WebGIS 工作台：QGIS 风格、现代化组件化设计、引擎可插拔。
> 本文档描述整体架构与各层职责，是所有模块开发的契约来源。

## 1. 设计目标与三大支柱

| 需求 | 实现策略 |
|---|---|
| **数据本地化** | 所有数据存于本地：File System Access API 直接读写用户选择的磁盘文件夹（`project.webgis.json` + `assets/` 目录）；IndexedDB 作为始终可用的持久层 |
| **计算下发** | 重型计算（格式解析、空间分析）全部运行在 Web Worker（comlink RPC），不阻塞主线程；未来可进一步接入 WASM（如 GDAL）或将更重的计算下沉到本地进程 |
| **自动保存** | 任何变更（图层/样式/视图/编辑）→ dirty 标记 → 1.2s 防抖 → 双轨保存（IDB 必写 + 磁盘尽力写）；关闭浏览器后从 IDB 恢复，重连磁盘后继续写盘 |

## 2. 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│ UI 层（React 组件）                                           │
│  Toolbar / LayerPanel / AttributeTable / StylePanel /        │
│  AnalysisPanel / StatusBar / Dialogs / MapView               │
├─────────────────────────────────────────────────────────────┤
│ 状态管理层（zustand stores + 桥接）                            │
│  project · selection · ui · history(undo/redo)               │
│  engineBridge（store ⇄ engine 增量同步）                      │
│  persistence（快照构建 / 自动保存 / 导入服务 / 启动恢复）        │
├─────────────────────────────────────────────────────────────┤
│ 核心层（core，引擎无关）                                       │
│  engine/types        MapEngine 抽象接口 + EngineRegistry      │
│  layers/model        图层模型（矢量/栅格，EPSG:4326）          │
│  style/types         符号化规范（单一/分类/渐变 + 标注）        │
│  crs/                坐标系注册表（中国常用 CRS）+ WKT 解析     │
│  datasource/         格式解析协议（Worker 实现）               │
│  analysis/           空间分析协议（Worker 实现）               │
│  storage/            FS Access / IndexedDB / 工程序列化        │
│  geo/transform       引擎无关坐标换算（proj4）                 │
├─────────────────────────────────────────────────────────────┤
│ 引擎适配层（engine/ol）OpenLayers v1 实现                      │
│  （未来：engine/maplibre 等，注册到 EngineRegistry）           │
└─────────────────────────────────────────────────────────────┘
```

**关键约定**：
- 业务几何统一 **EPSG:4326**；视图坐标系 **EPSG:3857**；坐标系换算只在引擎适配层发生（`ol/format/GeoJSON` 的 dataProjection/featureProjection）。
- UI 层永远不 import `ol`，只依赖 `core/engine/types` 的接口——这就是引擎可插拔的根基。

## 3. 引擎抽象（MapEngine）

`src/core/engine/types.ts` 定义完整接口，四个能力面：

1. **图层管理**：`addVectorLayer / addRasterLayer / removeLayer / updateVectorData / updateLayerStyle / setLayerVisible|Opacity|ZIndex / getLayerFeatures`
2. **视图**：`getView / setView / fitExtent`（视图状态可持久化）
3. **拾取与选择**：`identify(pixel) / setSelection / clearSelection`（事件 `click / selectionchange`）
4. **编辑**：`startDraw / cancelDraw / startModify / stopModify`（事件 `drawend / modifyend`）
5. **底图与导出**：`setBasemap / getBasemap / exportPng`——在线瓦片底图（OL 适配层 `basemap.ts`，全部 CORS 友好）与 PNG 制图导出（`export.ts`：画布合成 + 图题/图例/版权绘制）

事件模型：`engine.on('click', ...)` 返回解绑函数；`click/pointermove` 的坐标已换算为 4326。

**EngineRegistry**：`register(id, displayName, factory)` / `create(id?)`。v1 注册 OpenLayers；新增引擎（MapLibre GL 等）只需实现接口并注册，UI 零改动。

## 4. 图层与样式模型

- `LayerModel` = 矢量（features + fields + style + sourceFile）| 栅格（ArrayBuffer + 元信息），见 `core/layers/model.ts`。
- 图层顺序即 z 序（数组下标），`layerRev` 计数每次变更，引擎桥接按 rev 增量同步（变更的图层整体重加，保证一致）。
- 样式规范模拟 QGIS：`simple / categorized / graduated` + 标注，见 `core/style/types.ts`；引擎适配层将其翻译为 `ol/style` 的 StyleFunction。
- **图例自动化**（自动制图）：`core/style/classify.ts`（等距/分位数/Jenks 自然间断点）、`core/style/ramps.ts`（顺序/发散/定性制图色带，任意档数插值与反转）、`core/style/legend.ts`（图例项生成 `buildLegendItems` / 图例分组 `collectLegendGroups` / 一键符号化 `autoStyleSpec`）。地图图例浮层与 PNG 导出共用同一图例模型，所见即所得。

## 5. 坐标系策略

- 导入时若数据带 CRS（.prj、GeoTIFF geoKeys），通过 `crs/registry.ts`（内置 CGCS2000/西安80/北京54 常见带号）或 WKT 解析得到 proj4 定义，`normalizeToWgs84` 归一化到 4326。
- 原始 CRS 记录在 `layer.sourceCrs`，导出/保存不丢失元信息。

## 6. Worker 计算（计算下发）

- **datasource worker**：`parseFiles(files) → ParseResult[]`（GeoJSON/SHP/KML/GPX/GeoTIFF/CSV/GeoPackage + 导出 geojson/csv/kml/shp/gpx/gpkg；Shapefile 导出为 shp/shx/dbf/prj/cpg 打包 zip，GeoPackage 经 sql.js WASM 读写）。
- **analysis worker**：`runAnalysis(op, layers) → AnalysisOutcome`（buffer/intersect/union/difference/clip/dissolve/centroid/fieldStats/layerStats/bbox，turf v7）。
- 通信协议均为 comlink；主线程侧封装在 `service.ts`，UI 只调 service。

## 7. 持久化与自动保存

磁盘布局（File System Access 文件夹）：

```
<工程文件夹>/
├── project.webgis.json     # 工程 + 矢量要素内联；栅格数据 → {__bin: base64}
└── assets/<layerId>.tif    # 栅格图层的二进制副本
```

- IDB 数据库 `spatial-harness`：`projects`（含完整快照，ArrayBuffer 原生存储）+ `meta`（文件夹句柄）。
- 保存策略：IDB **必写**；磁盘有句柄且权限 granted 时**另写**。浏览器重启后：从 IDB 恢复工程 → 恢复文件夹句柄 → 点击「重新连接文件夹」重新授权（Chrome 要求用户手势）。
- 保存状态（saved/disk/idb-only/error）实时显示在状态栏。

## 8. 编辑与撤销

- 绘制（点/线/面）与顶点编辑由引擎交互完成；`drawend/modifyend` 事件 → 桥接层写回 store（`modifyend` 通过 `getLayerFeatures` 回读最新几何）→ 自动保存。
- 撤销/重做：命令模式（`state/history.ts`），`featuresCommand(layerId, label, before, after)` 覆盖绘制、顶点编辑、属性编辑、删除。

## 9. 扩展路线图

- **引擎**：MapLibre GL 适配器（矢量瓦片化渲染）、Cesium 3D
- **格式**：GeoPackage 瓦片表、gdal3.js WASM 栅格处理
- **分析**：网络分析、栅格计算器、热力图（worker 内生成）
- **计算下沉**：可选本地计算守护进程（HTTP/WebSocket），浏览器判断负载后转发重型任务
- **制图输出**：打印布局（PNG 导出已实现：图题/图例/版权合成，1x/2x 分辨率）

## 10. 目录结构

```
src/
├── core/            # 引擎无关核心（契约 + 纯逻辑）
│   ├── engine/      #   types.ts 接口 / registry.ts / ol/ 适配器
│   ├── layers/      #   图层模型
│   ├── style/       #   符号化规范 + 分级/色带/图例自动化
│   ├── crs/         #   坐标系
│   ├── datasource/  #   格式解析（worker）
│   ├── analysis/    #   空间分析（worker）
│   ├── demo/        #   标准 demo 场景注册表（scenarios.ts）
│   ├── storage/     #   FS Access / IDB / 工程文件
│   └── geo/         #   坐标换算
├── state/           # zustand stores + 桥接 + 持久化接线 + demo 加载器
├── components/      # UI（ui/ 基础组件库，panels/ 业务面板）
└── styles/          # Tailwind v4 主题
```

## 11. 标准 demo 体系

`demo/` 目录同时是**数据仓库**与 **vite publicDir**（dev 下直接可访问、build 时拷入 dist）：

- `demo/data/`：轻量开源数据（Natural Earth 公共领域 / USGS 公共领域 / 手工样例），明细与复现方式见 `demo/SOURCES.md`、`scripts/prepare_demo_data.mjs`
- 场景注册表 `src/core/demo/scenarios.ts`：每个场景 = 数据文件 + 自动符号化配置 + 底图 + 初始视图；加载器 `src/state/demo.ts`
- 入口：欢迎页 / 工具栏「示例」/ URL 参数 `?demo=<id>`（供 `scripts/capture_demos.py` 批量截图）
