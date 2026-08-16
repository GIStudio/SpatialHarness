# 让 DeepSeek Harness 直接操作 WebGIS：SpatialHarness 的 MCP 集成实践

> 投稿草稿 · DeepSeek Harness GitHub Discussions
> 仓库：https://github.com/GIStudio/SpatialHarness

---

## 一句话

我们把一个浏览器里的 GIS 工作台（SpatialHarness）包装成了 **MCP 服务器**，用 8 行配置接进 DeepSeek Harness 后，模型就能直接"做 GIS"：加载 Shapefile/GeoJSON/KML/CSV、做缓冲区/相交/联合/差集/裁剪/融合/质心、统计字段，全程无需写一行代码。

---

## 背景

[SpatialHarness](https://github.com/GIStudio/SpatialHarness) 是我们开发的纯本地 WebGIS 工作台（QGIS 交互范式，浏览器运行，File System Access API 直读本地磁盘，空间分析全部复用 turf）。它有一个引擎无关的核心层 `src/core`：格式解析 + 空间分析算子，全部是纯函数。

最近 DeepSeek Harness 开放了社区，我们想让它能"操作"我们的 GIS 项目。评估了三种方案：

| 方案 | 结论 |
|---|---|
| **MCP** | ✅ DSH 一等公民：内置 `@deepseek-ai/dsh-mcp-client` 插件，stdio 连接、自动发现工具、断线重连、HMR。行业标准协议。 |
| CLI | ⚠️ 只能走通用 `bash` 工具，无 schema 校验，模型容易用错参数 |
| Web 页面 | ⚠️ DSH 的 web 工具是只读搜索/抓取，无法驱动 GUI |

结论很明确：**MCP 最标准、成本最低**。

## 实现：核心逻辑零改动

关键点：MCP 服务器**没有第二套实现**，直接复用 Web 端的 `src/core`（turf 算子 + 格式解析器，Node 兼容，零浏览器 API 依赖）：

```
DeepSeek Harness
  └─ @deepseek-ai/dsh-mcp-client（stdio）
       └─ node mcp/dist/server.cjs   ← SpatialHarness MCP 服务器
            ├─ mcp/src/   （工具注册 / 会话数据集注册表 / 参数校验）
            └─ src/core/  （复用 Web 端：空间分析 + 格式解析，同源）
```

设计上几个有意思的点：

- **数据集链式引用**：`load_dataset` 把文件解析进会话注册表并返回 `layer_id`（L1、L2…）；每次分析结果也自动注册。模型可以 `load_dataset → buffer → field_stats` 一路传 ID 链式做下去，不用反复传输 GeoJSON。
- **图层引用双通道**：`layer_id`（推荐）或内联 `geojson`（FeatureCollection）二选一，灵活且参数可控。
- **自包含单文件**：esbuild 把 SDK + turf + shpjs 全部打进 `dist/server.cjs`（3MB），运行时零外部依赖，`node dist/server.cjs` 即起。
- **15 个工具**：`load_dataset` / `list_datasets` / `get_dataset` / `unload_dataset` + 10 个空间分析算子（buffer/intersect/union/difference/clip/dissolve/centroid/bbox/field_stats/layer_stats）+ `convert_format`（GeoJSON/CSV/KML 导出）。

## 接入：8 行配置

在 DSH 组合文件（`~/.dsh/profiles/<profile>/cordis.patch.yml`）里加一段即可：

```yaml
- insert:
    - id: mcp-spatial
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: spatial
        transport: stdio
        command: /opt/homebrew/bin/node
        args: ['<仓库绝对路径>/mcp/dist/server.cjs']
        cwd: <仓库绝对路径>
        failOnStartupError: true
```

启动后模型侧出现 `mcp__spatial__load_dataset`、`mcp__spatial__buffer` 等原生工具。

## 验证：真实模型端到端跑通

用 headless profile 跑了一个真实任务（DeepSeek V4 Flash），会话日志里的工具调用序列：

```
turn 1 step 1  mcp__spatial__load_dataset  {"path": ".../testdata/parcels.geojson"}
turn 1 step 2  mcp__spatial__layer_stats   {"layer_id": "L1"}
turn 1 step 3  mcp__spatial__buffer        {"layer_id": "L1", "distance": 500, "unit": "meters"}
turn 1 step 4  mcp__spatial__field_stats   {"layer_id": "L1", "field": "pop"}
```

模型给出的结果全部正确：

| 指标 | 结果 |
|---|---|
| 加载要素数 | 3（Polygon，EPSG:4326 归一化） |
| 缓冲区 | 新数据集 L2「缓冲区_parcels_500m」，3 要素 |
| pop 求和 / 均值 | 4500 / 1500（min 800，max 2500） |

单元测试 22 个 + 真实 stdio 握手冒烟全绿；Web 端原有 33 个测试不受影响。

## 给 DSH 团队的小建议（验证中发现）

1. **profile 级 patch 不支持热重载**：修改 `~/.dsh/profiles/<profile>/cordis.patch.yml` 后，运行中的 web 实例不会自动生效（插件列表无变化），需要重启进程才能加载新插件。mcp-client 插件自身支持 HMR（改配置可热换连接），但 profile patch 层似乎不在 watch 范围内。如果能像 settings.yaml 一样热重载、或 GUI 提供一个「应用并重载」按钮，迭代体验会好很多。
2. **（正面反馈）MCP 接入链路非常顺滑**：stdio 子进程拉起、工具发现、JSON Schema 校验（`optional`/`enum`/`describe`/`record` 等关键字均被支持）、错误返回（`-32602` / `isError`）全部按规范工作；DSH 的 mcp-client 总是携带 `arguments`（即使零参工具也传 `{}`），配合规范客户端零问题。`!!js` 表达式让 env 相关配置写起来很舒服。

## 邀请讨论

- 有没有人把类似 WebGIS / 地图 / 空间数据项目接入 DSH？你们选了 MCP 还是别的路子？
- MCP 服务器 + 会话注册表（layer_id 链式引用）这个模式，对其他"有状态分析"类工具（CAD、BIM、科学计算）有没有参考价值？
- 下一步我们打算：Shapefile 导出、GeoPackage、栅格分析、工程文件（project.webgis.json）读写。欢迎提需求。

---

## English TL;DR

We wrapped our browser-based WebGIS workbench [SpatialHarness](https://github.com/GIStudio/SpatialHarness) as an MCP server so DeepSeek Harness can perform GIS work directly: loading Shapefile/GeoJSON/KML/CSV, running buffer/intersect/union/difference/clip/dissolve/centroid/stats, and exporting formats — no code required. The server reuses the web app's core logic (turf ops + format parsers) with zero duplication, exposes 15 tools with chainable `layer_id` references, and ships as a self-contained 3 MB single file. Integration is an 8-line `cordis.yml` entry. Verified end-to-end with a real model run: `load_dataset → layer_stats → buffer → field_stats` all correct. One suggestion for the DSH team: hot-reload for profile-level `cordis.patch.yml` (new plugins currently require a process restart). Everything else — stdio MCP bridging, tool discovery, JSON Schema validation, error handling — worked flawlessly. Repo: https://github.com/GIStudio/SpatialHarness
