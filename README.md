# SpatialHarness

> **纯本地 WebGIS 工作台** —— 把桌面 GIS 装进浏览器。
> 模仿 QGIS 交互范式、采用通用 GIS 数据格式、现代化组件化架构。

[![CI](https://github.com/GIStudio/SpatialHarness/actions/workflows/ci.yml/badge.svg)](https://github.com/GIStudio/SpatialHarness/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)

**本地优先**：数据全部保存在你自己的电脑上（磁盘文件夹或浏览器工作区），不经过任何服务器；
**计算下发**：格式解析与空间分析运行在 Web Worker，主线程不卡顿；
**自动保存**：所有操作自动保存，关闭浏览器也不丢失。

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 🗂️ **数据本地化** | File System Access API 直接读写本地磁盘文件夹（工程文件 + 数据文件）；IndexedDB 作为浏览器内持久层，全浏览器可用 |
| ⚙️ **计算下发** | 数据解析与空间分析全部运行在 Web Worker（comlink），主线程不卡顿 |
| 💾 **自动保存** | 任意变更 1.2s 防抖自动保存（双轨：IndexedDB 必写 + 磁盘尽力写），重启浏览器自动恢复 |
| 🧩 **引擎可插拔** | 引擎抽象层为核心（`MapEngine` 接口 + 注册表），OpenLayers 为 v1 实现；未来可注册 MapLibre GL 等新引擎，UI 零改动 |
| 🎨 **QGIS 风格符号化** | 单一符号 / 分类符号 / 渐变符号 + 标注，实时预览 |
| 📊 **属性表** | 虚拟滚动大表、排序、筛选、单元格直接编辑、与地图选择联动 |
| 🔬 **空间分析工具箱** | 缓冲区 / 相交 / 联合 / 差集 / 裁剪 / 融合 / 质心 / 字段统计 / 图层统计 / 外包矩形 |
| ✏️ **编辑与绘制** | 绘制点线面、顶点编辑、属性编辑，支持撤销/重做（命令模式） |

## 🚀 快速开始

```bash
pnpm install
pnpm dev          # http://localhost:5173 （推荐 Chrome / Edge）
```

```bash
pnpm test         # 单元测试（vitest）
pnpm build        # 类型检查 + 生产构建
```

首次使用：点击「新建工程」→ 可选「选择文件夹」作为磁盘保存位置 → 用「导入文件」或「打开数据文件夹」加载你的 GIS 数据。

## 📦 支持的格式

| 格式 | 导入 | 导出 | 说明 |
|---|---|---|---|
| GeoJSON | ✅ | ✅ | 原生格式，编辑后可直接写回 |
| Shapefile | ✅ | ✅ | 导入 `.shp + .dbf + .prj`（支持 `.zip` 包），自动坐标系归一化；导出为 `.zip`（shp/shx/dbf/prj/cpg 五件套，UTF-8 属性编码） |
| GeoPackage | ✅ | ✅ | 纯 WASM（sql.js）读写，无原生依赖；多要素表导入为多图层，导出 EPSG:4326 单表 `.gpkg` |
| KML | ✅ | ✅ | |
| GPX | ✅ | ✅ | 导入 wpt/trk/rte；导出点 → wpt、线 → trk（面按外环转 trk 并告警） |
| GeoTIFF | ✅ | ❌ | 栅格渲染（懒加载分块） |
| CSV | ✅ | ✅ | 自动识别经纬度列 |
| 工程文件 | ✅ | ✅ | `project.webgis.json`（含图层树/样式/视图/数据） |

坐标系：内置 CGCS2000 / 西安80 / 北京54 常用带号 + `.prj` WKT 解析，导入时统一归一化到 EPSG:4326，原始坐标系保留在图层元信息。

## 🏗️ 架构一览

```
UI 层（React 组件）            → Toolbar / LayerPanel / AttributeTable / StylePanel / AnalysisPanel
状态管理层（zustand）           → project / selection / ui / history + engineBridge + persistence
核心层（core，引擎无关）        → engine接口 / layers模型 / style规范 / crs / datasource / analysis / storage
引擎适配层（engine/ol）        → OpenLayers v1（未来可插拔 MapLibre 等）
```

详细设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 🧪 验证

- **单元测试**：Web 端 50 例（存储双轨往返、手写二进制 Shapefile fixture、Shapefile / GeoPackage 导出→导入往返（含中文属性/面孔体/混合几何）、GPX 导出结构、turf 空间分析含多要素叠加语义、WKT 解析）+ MCP 端 27 例
- **冒烟测试**：`scripts/smoke_test.py`（Playwright）覆盖完整用户旅程：新建工程 → 导入 → 自动保存 → 识别 → 样式 → Shapefile/GPX/GeoPackage 导出下载 → 分析 → 绘制 → 撤销/重做 → 刷新恢复 → GeoPackage 导入回环

## 🤖 AI 可操作性（MCP）

SpatialHarness 以 **MCP 服务器**形式暴露给 AI 客户端（DeepSeek Harness / Claude Code / Codex 等）：
空间分析（缓冲区/相交/联合/差集/裁剪/融合/质心/统计）与矢量数据解析（GeoJSON/Shapefile/KML/GPX/CSV）全部可被模型直接调用，逻辑与 Web 端同源（`src/core`）。

```bash
pnpm --filter @spatial-harness/mcp-server build   # 生成 mcp/dist/server.cjs
```

接入 DeepSeek Harness：在 `cordis.yml` 注册 `@deepseek-ai/dsh-mcp-client` 插件（stdio，`command: node`，`args: [<仓库>/mcp/dist/server.cjs]`）。
完整说明与工具清单见 [docs/dsh-integration.md](docs/dsh-integration.md)。

## 🤝 贡献

欢迎 PR。开发约定：

- 业务逻辑只依赖 `src/core/` 的引擎无关契约，禁止在 UI 层 import `ol`
- 所有计算放入 `src/core/*/worker.ts`，主线程只调 service
- 提交前保证：`pnpm exec tsc -b --noEmit` 零错误、`pnpm test` 全绿、`pnpm build` 成功

## 🗺️ 路线图

- 引擎：MapLibre GL 适配器、Cesium 3D
- 格式：GeoPackage 瓦片表、gdal3.js WASM 栅格处理
- 分析：网络分析、栅格计算器、热力图
- 制图：打印布局、PNG 导出

## 📄 License

[MIT](LICENSE) © GIStudio
