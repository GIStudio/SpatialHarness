# SpatialHarness Web 工作台 · Agent Skill

为 AI 编码代理（Claude Code / Codex / ZCode 等）准备的 SpatialHarness 操作指引：如何选对入口、哪些规则容易踩坑。

## 三个入口，按场景选择

### 1. 活地图编辑（推荐，用户正在看地图时）

前置：`spatialharness serve` 已运行；用户在 Web 工作台「分析面板 → Python 分析」勾选了「AI 编辑」。

使用 `spatialharness mcp`（stdio MCP 服务器）里的 `map_*` 工具：

```
map_get_project   → 先调用它拿图层清单和 layerId（编辑前必读）
map_add_features  / map_update_features / map_delete_features / map_replace_features
map_add_layer / map_remove_layer / map_set_layer_style
map_fit_layer / map_set_view / map_status
```

特性：每次编辑进入用户的历史栈，**Ctrl+Z 可撤销**；校验失败会返回明确错误。

### 2. Headless 工程文件（无浏览器/批处理时）

`spatialharness mcp` 的 `write_project` 工具：直接产出 `project.webgis.json`，
用户在 Web 工作台「打开数据文件夹」载入。参数：`{path, name, layers: [{name, features, style?}]}`。

### 3. Python 计算（可达性/街景等重分析）

同 MCP 服务器的计算插件工具（`spatial_accessibility`、`street_solar`…），
或 HTTP 桥 `POST /run/<plugin>`。与入口 1 组合可完成"算 → 落图层 → 调样式"闭环：
计算结果 GeoJSON 用 `map_add_features` 写回活地图。

## 易错规则

1. **坐标系一律 EPSG:4326**（[lon, lat]，经度在前）；越界坐标会被浏览器端拒绝
2. `layerId` 必须来自 `map_get_project` 返回值，不要猜测
3. 编辑工具要求桥在线 + Web 端已开启「AI 编辑」；返回 `browser_not_connected`/timeout 时
   先 `map_status` 探测，并提示用户开启开关
4. `map_set_layer_style` 仅接受 `symbol.kind === 'simple'` 的样式
   （字段白名单：pointColor/pointRadius/pointSymbol/strokeColor/strokeWidth/strokeDash/fillColor）
5. `write_project` 的 `path` 是 AI 写入的输出路径；告知用户文件位置
6. 编辑前若不确定现状，先 `map_get_project`；多步编辑逐条提交，每条可独立撤销

## 相关文档

- 设计文档：`docs/ai-editing.md`
- 架构：`docs/ARCHITECTURE.md`
- Python 包：github.com/GIStudio/SpatialUtils（PyPI `spatialharness`）
