# SpatialHarness × DeepSeek Harness 集成指南

本文档说明如何让 **DeepSeek Harness（DSH）** 直接操作 SpatialHarness 的 GIS 能力。

## 方案：MCP（Model Context Protocol）

| 方案 | 结论 |
|---|---|
| **MCP（采用）** | DSH 一等公民支持：内置 `@deepseek-ai/dsh-mcp-client` 插件，通过 stdio 连接外部 MCP 服务器，自动发现工具并注册为模型原生工具（`mcp__spatial__<tool>`）。行业标准协议（Claude Code / Codex 同款）。 |
| CLI | 只能走通用 `bash` 工具，无 schema 校验、输出解析靠约定，模型易用错。 |
| Web 页面 | DSH 的 `tool-web` 只有只读的 `web_search`/`web_fetch`，无法驱动 GUI。 |

## 架构

```
DeepSeek Harness
  └─ cordis.yml 注册 @deepseek-ai/dsh-mcp-client 插件（stdio）
       └─ 子进程：node <repo>/mcp/dist/server.cjs   ← SpatialHarness MCP 服务器
            ├─ mcp/src/          （工具注册、会话数据集注册表、参数校验）
            └─ src/core/         （复用 Web 端核心：turf 空间分析 + 格式解析，Node 兼容零改动）
```

核心亮点：**分析与解析逻辑与 Web 端完全同源**（`src/core/analysis/ops.ts`、`src/core/datasource/parse.ts`），
MCP 服务器只做薄封装，没有第二套实现。

## 快速开始

### 1. 构建

```bash
pnpm install
pnpm --filter @spatial-harness/mcp-server build
# 产物：mcp/dist/server.cjs（自包含单文件，无外部运行时依赖）
```

### 2. 本地验证

```bash
pnpm --filter @spatial-harness/mcp-server test     # 22 个单元测试
pnpm --filter @spatial-harness/mcp-server smoke    # 真实 MCP stdio 握手冒烟
pnpm --filter @spatial-harness/mcp-server start    # 手动启动（等待客户端连接）
```

### 3. 接入 DeepSeek Harness

在 DSH 的 `cordis.yml` 组合文件中添加一个插件实例（路径改为你机器上的绝对路径）：

```yaml
- id: mcp-spatial
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: spatial
    transport: stdio
    command: node
    args: ['/绝对/路径/SpatialHarness/mcp/dist/server.cjs']
    cwd: /绝对/路径/SpatialHarness
    failOnStartupError: true
```

启动后模型即可使用 `mcp__spatial__load_dataset`、`mcp__spatial__buffer` 等原生工具。

> `cwd` 决定 `load_dataset` 相对路径的基准目录；建议用绝对路径避免歧义。
> DSH 会清理子进程环境变量，服务器不需要任何凭据。

## 工具清单（15 个）

### 数据集管理

| 工具 | 说明 |
|---|---|
| `load_dataset` | 从本地文件路径（`path`）或内联内容（`data` + `name`）加载 GIS 数据：GeoJSON / Shapefile（`.shp`、`.zip`、`.shp+.dbf+.prj`）/ KML / GPX / CSV（自动识别经纬度列）/ GeoTIFF（仅元信息）。矢量统一归一化到 EPSG:4326。返回 `layer_id`。 |
| `list_datasets` | 列出会话中所有数据集（layer_id、名称、格式、要素数、几何类型）。 |
| `get_dataset` | 查看数据集详情；`include_geojson=true` 时返回完整 GeoJSON。 |
| `unload_dataset` | 从会话移除数据集（只影响内存，不删文件）。 |

### 空间分析（复用 Web 端 turf 算子，结果自动注册为新数据集，可链式调用）

| 工具 | 说明 |
|---|---|
| `buffer` | 缓冲区：`layer_id`/`geojson` + `distance` + `unit`（meters/kilometers/miles）+ `dissolve` |
| `intersect` | 相交（面×面，QGIS 叠加语义） |
| `union` | 联合（面） |
| `difference` | 差集 A−B（面） |
| `clip` | 裁剪（面×面；点被面包含则保留） |
| `dissolve` | 融合（按 `field` 分组或全部） |
| `centroid` | 质心（保留原属性） |
| `bbox` | 最小外接矩形 |
| `field_stats` | 数值字段统计（计数/空值/求和/平均/最小/最大/标准差） |
| `layer_stats` | 图层统计（要素数/点线面数量/总面积/总长度/外包矩形） |

### 格式转换

| 工具 | 说明 |
|---|---|
| `convert_format` | 导出 GeoJSON / CSV（点带 lon,lat，线面带 WKT）/ KML / GPX 文本，或 Shapefile（`.zip` 打包 shp/shx/dbf/prj/cpg，UTF-8 属性）/ GeoPackage（`.gpkg`，SQLite），二进制以 base64 返回 |

所有分析工具的图层引用支持两种方式：`layer_id`（推荐，已加载/已生成的数据集）或内联 `geojson`（FeatureCollection）。

## 使用示例

接入 DSH 后，可以直接用自然语言操作：

> 「加载 /data/parcels.geojson，对地块做 500 米缓冲区，然后统计缓冲区图层中 pop 字段的均值」

模型会依次调用：`load_dataset` → `buffer` → `field_stats`，全程通过 `layer_id` 链式传递，无需重复传输数据。

## 安全说明

- 服务器**只读**本地文件系统（`load_dataset` 仅读取，无任何写文件操作）；`unload_dataset` 只清内存。
- 分析结果只存在于服务器进程内存中（会话级），进程退出即消失。
- 所有工具标注了 `readOnlyHint` / 非破坏性；没有网络出站请求。
- 运行在 DSH 清理后的受限环境变量中，无凭据需求。

## 已知限制

- 栅格（GeoTIFF）仅返回元信息，不参与空间分析（与 Web 端一致，分析工具箱仅矢量）。
- GeoPackage 经 sql.js WASM 读写（无原生依赖）：导入只解析要素表（瓦片/属性表忽略且不做坐标转换，非 4326 会告警）；导出为 EPSG:4326 单要素表。
- `load_dataset` 的 `path` 仅支持单文件（`.shp` 自动带同主干名组件）；目录批量导入请逐个调用。
- 会话数据集存在服务器进程内存中，DSH 重启后需重新 `load_dataset`。
- 输入 `arguments` 缺失的调用（不符合 MCP 规范）会返回校验错误，不影响进程。
