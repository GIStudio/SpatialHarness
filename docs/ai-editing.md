# AI 辅助编辑（AI-Assisted Editing）设计与实现

> 状态：v1 实施中 · 对应知识库分析：`notes.gistudio.xyz` 《GeoLibre vs SpatialHarness》§5
> 关联：Python 包 `spatialharness`（PyPI，`mcp` / `serve` 命令）、Web 工作台 `spatial-harness`（npm）

## 1. 目标

让 AI（MCP 客户端：Claude Code / Codex / ZCode 等）能够**编辑运行中的活地图**，并与用户手动编辑同轨：

- AI 的每次编辑都进入 `history` 命令栈 → **可 Ctrl+Z 撤销**、复用自动保存
- AI 可读工程状态、增删改要素/图层、设样式、聚焦视图
- 与 Python 分析插件闭环：算可达性 → 结果直接落图层 → AI 继续调样式

非目标（v1）：协同多客户端、冲突合并、栅格编辑。

## 2. 总架构：三端口一队列

浏览器无法监听端口，而它已能主动访问 Python 桥（`spatialharness serve`，127.0.0.1）。
因此用**桥作中转队列**，AI → 桥 → 浏览器轮询取命令 → 应用 → 结果回传：

```
MCP 客户端(AI)                    Python 桥                     Web 工作台
     │  tools/call map_add_features   │                              │
     ├────────────────────────────►  POST /edit/submit              │
     │                                │  入队 {id,tool,args}          │
     │                                │  长轮询等待结果(≤30s)          │
     │                                │◄──── GET /edit/pending ──────┤  每 1s 轮询
     │                                │  返回命令 ───────────────────►│
     │                                │                              │  schema 校验
     │                                │                              │  组装 Command
     │                                │                              │  history.push ← 可撤销
     │                                │◄──── POST /edit/result ──────┤  {id, ok, summary}
     │◄──────────────────────────────┤  {ok, summary}                │
```

关键点：
- **命令只经一条路径进地图**：`applyEdit` → 组装 `Command` → `useHistoryStore.push`。与 UI 编辑同轨，undo/自动保存天然成立
- **浏览器是闸门**：Web 端默认关闭轮询（"AI 编辑"开关），关着则所有编辑工具返回 `browser_not_connected`——AI 无法越过用户
- 桥仅绑 127.0.0.1；超时 30s；命令带递增 id，重复提交幂等丢弃

## 3. 编辑工具规格（L1）

所有工具经桥转发到浏览器执行。`summary` 为人类可读摘要（供 flash 与 AI 理解）。

| 工具 | 参数 | 行为 | 命令 |
|---|---|---|---|
| `map_status` | — | 工程概要 + 浏览器是否在线 | — |
| `map_get_project` | — | 图层清单（id/name/几何类型/要素数/字段）+ 视图 | — |
| `map_add_features` | `layerId` 或 `layerName`, `features: Feature[]` | 目标图层不存在则创建 | `featuresCommand`(before,after) |
| `map_replace_features` | `layerId`, `features` | 整体替换图层要素 | `featuresCommand` |
| `map_update_features` | `layerId`, `features`（按 `feature.id` 匹配合并） | 更新匹配要素 | `featuresCommand` |
| `map_delete_features` | `layerId`, `featureIds` | 删除要素 | `featuresCommand` |
| `map_add_layer` | `name`, `features`, `style?` | 新建矢量图层（默认样式） | add/remove 命令对 |
| `map_remove_layer` | `layerId` | 删除图层 | remove/add 命令对 |
| `map_set_layer_style` | `layerId`, `style` | 设置 `LayerStyle` JSON | updateLayer 命令对 |
| `map_fit_layer` | `layerId?` | 缩放至图层 | —（视图不进栈） |
| `map_set_view` | `center [lon,lat]`, `zoom` | 设置视图状态 | — |

校验（浏览器端 `applyEdit`）：
1. GeoJSON Feature 结构校验（type/geometry/properties），畸形整体拒绝
2. 坐标按 EPSG:4326 约定（与全工程一致），NaN/越界(±180/±90) 拒绝
3. style 走 `LayerStyle` 形状检查（symbol.kind 必须为 `simple`，字段白名单）

v1 省略"提案-确认"对话框：编辑即时应用但**全部可撤销**且 flash 明示（同 GeoLibre Assistant 先例）；确认模式留作选项（v1.1）。

## 4. 传输协议（桥新增端点）

```
POST /edit/submit   {tool, args, wait?}   → {id} 或 {ok, summary}（wait=true 时长轮询结果）
GET  /edit/pending?ack=<lastId>           → {commands: [{id, tool, args}]}（浏览器轮询，兼作心跳）
POST /edit/result    {id, ok, summary?|error?}  → {}（浏览器回传）
GET  /edit/status                          → {browser_connected, pending}
```

浏览器心跳：`last_poll` 时间戳，>5s 未轮询视为离线。MCP 端工具统一封装：submit(wait=true, 30s)。

## 5. Web 端组件

- `src/core/bridge/editClient.ts`（core，无 ol 依赖）：轮询循环、ack 游标、结果回传
- `src/core/bridge/applyEdit.ts`：schema 校验 + 组装 `Command`（编辑语义的唯一入口）
- `PythonAnalysisSection` 增加"AI 编辑"开关 + 状态行（在线/最后操作），复用既有桥地址
- `flash` 摘要格式：`AI 编辑：+12 要素 → 图层X（可撤销）`

## 6. L2：headless 工程文件生成

`spatialharness mcp` 增加 `write_project(path, name, layers)`：直接产出
`project.webgis.json`（`ProjectFile` v1：app/version/crs/view/layerOrder/layers），
Web 端"打开数据文件夹"即可载入。与 L1 共用同一 `LayerModel` 形状（AI 从
`map_get_project` 拿到的图层 id/字段可直接复用）。纯 Python 生成，无需浏览器。

## 7. L3：Agent Skill

仓库根 `SKILL.md`：教外部 agent 三入口怎么选——活地图编辑走 `map_*` 工具
（需 Web 端开启 AI 编辑）、无浏览器走 `write_project`、重计算走普通计算插件；
列出易错规则（4326 坐标、classify 需内联 GeoJSON、`layerId` 从 `map_get_project` 获取）。

## 8. 测试与验收

| 层 | 测试 | 通过标准 |
|---|---|---|
| Python 桥 | 队列端点单测（submit/pending/result/超时） | pytest 全绿 |
| Python MCP | map_* 工具转发（桥 mock） | pytest 全绿 |
| Web applyEdit | 各操作 → history 命令正确入栈/可撤销 | vitest 全绿 |
| Web editClient | 轮询/ack/心跳（fetch mock） | vitest 全绿 |
| 端到端 | serve + vite + 浏览器：开启 AI 编辑 → curl 提交 add_features → 图层出现 → Ctrl+Z 消失 | 实测截图 |

## 9. 分期

- **v1（本次）**：L1 全量 + L2 `write_project` + L3 SKILL.md
- v1.1：提案-确认开关、`map_classify`（复用自动制图）、编辑限流
- v2：多客户端会话隔离、编辑审计日志
