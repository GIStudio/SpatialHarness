/**
 * SpatialHarness MCP 服务器入口。
 *
 * 把 WebGIS 能力以 MCP 工具暴露给 DeepSeek Harness 等客户端：
 *  - 数据集管理：load_dataset / list_datasets / get_dataset / unload_dataset
 *  - 空间分析：buffer / intersect / union / difference / clip / dissolve / centroid / bbox / field_stats / layer_stats
 *  - 格式导出：convert_format
 *  - 栅格处理（GDAL WASM）：raster_info / raster_translate / raster_warp
 *
 * 复用 Web 端 src/core 的解析与分析逻辑（turf 纯函数，Node 兼容）。
 * 运行：node dist/server.cjs（stdio 传输，配合 DSH 的 @deepseek-ai/dsh-mcp-client 插件）。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { DatasetStore } from './registry'
import {
  handleBbox,
  handleBuffer,
  handleCentroid,
  handleClip,
  handleConvertFormat,
  handleDifference,
  handleDissolve,
  handleFieldStats,
  handleGetDataset,
  handleIntersect,
  handleRasterInfo,
  handleRasterTranslate,
  handleRasterWarp,
  handleLayerStats,
  handleListDatasets,
  handleLoadDataset,
  handleUnloadDataset,
  handleUnion,
} from './handlers'

/** 内联 GeoJSON FeatureCollection 的宽松 schema（避免深层校验，尽量兼容 DSH 的 JSON Schema 子集） */
const geojsonSchema = z
  .object({
    type: z.literal('FeatureCollection'),
    features: z.array(z.record(z.string(), z.unknown())),
  })
  .describe('内联 GeoJSON FeatureCollection（与 layer_id 二选一）')

const layerRef = {
  layer_id: z.string().optional().describe('已加载数据集的 ID（load_dataset / 分析结果返回的 layer_id）'),
  geojson: geojsonSchema.optional(),
}

const includeGeojson = {
  include_geojson: z.boolean().optional().describe('为 true 时在返回文本中附带完整 GeoJSON（数据量大时慎用）'),
}

const VECTOR_OPS_DESC =
  '结果为新的数据集，自动注册并返回 layer_id（如 L2），可用于后续链式分析。返回文本含要素数/几何类型/外包矩形/字段摘要；include_geojson=true 可附带完整 GeoJSON。'

export function registerTools(server: McpServer, store: DatasetStore): void {
  server.registerTool(
    'load_dataset',
    {
      title: '加载 GIS 数据集',
      description:
        '从本地文件路径（path）或内联内容（data）加载 GIS 数据：GeoJSON/JSON、Shapefile（.shp/.zip 或 .shp+.dbf+.prj）、KML、GPX、CSV（自动识别经纬度列）。返回加载的数据集 layer_id 及摘要，矢量结果统一归一化到 EPSG:4326。',
      inputSchema: {
        path: z.string().optional().describe('本地文件绝对或相对路径（相对当前工作目录）。.shp 会自动读取同名的 .dbf/.prj；.zip 可含多个图层'),
        name: z.string().optional().describe('使用 data 时的文件名（必须含扩展名，如 data.geojson、roads.csv、cities.zip）'),
        data: z.string().optional().describe('文件内容：默认按 UTF-8 文本；二进制格式（shp/zip/geotiff）请用 encoding=base64'),
        encoding: z.enum(['utf8', 'base64']).optional().describe('data 的编码方式，默认 utf8'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (args) => handleLoadDataset(store, args),
  )

  server.registerTool(
    'list_datasets',
    {
      title: '列出已加载数据集',
      description: '列出当前会话中所有已加载/已生成的数据集（layer_id、名称、格式、要素数、几何类型）。',
      // 空 zod object 在 SDK 的 zod v4-mini 兼容路径下对缺失 arguments 会崩，
      // 用宽松 record 让缺参/空参都安全
      inputSchema: z.record(z.string(), z.unknown()),
      annotations: { readOnlyHint: true },
    },
    () => handleListDatasets(store),
  )

  server.registerTool(
    'get_dataset',
    {
      title: '查看数据集详情',
      description: '查看指定数据集的要素数、几何类型、字段、外包矩形；include_geojson=true 时返回完整 GeoJSON。',
      inputSchema: {
        layer_id: z.string().describe('数据集 ID'),
        ...includeGeojson,
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleGetDataset(store, args),
  )

  server.registerTool(
    'unload_dataset',
    {
      title: '移除数据集',
      description: '从会话中移除一个已加载/已生成的数据集（仅影响本会话内存，不删除任何文件）。',
      inputSchema: {
        layer_id: z.string().describe('数据集 ID'),
      },
    },
    (args) => handleUnloadDataset(store, args),
  )

  server.registerTool(
    'buffer',
    {
      title: '缓冲区分析',
      description: `对图层生成缓冲区（turf buffer）。${VECTOR_OPS_DESC}`,
      inputSchema: {
        ...layerRef,
        distance: z.number().describe('缓冲距离（数值，须为正数）'),
        unit: z.enum(['meters', 'kilometers', 'miles']).optional().describe('距离单位，默认 meters'),
        dissolve: z.boolean().optional().describe('是否融合重叠缓冲区，默认 false'),
        ...includeGeojson,
      },
    },
    (args) => handleBuffer(store, args),
  )

  server.registerTool(
    'intersect',
    {
      title: '相交分析',
      description: `求 A、B 两个面图层逐对要素的公共交集（QGIS 叠加语义）。仅支持面图层。${VECTOR_OPS_DESC}`,
      inputSchema: {
        layer_a_id: z.string().optional().describe('图层 A 的数据集 ID（与 layer_a_geojson 二选一）'),
        layer_a_geojson: geojsonSchema.optional(),
        layer_b_id: z.string().optional().describe('图层 B 的数据集 ID（与 layer_b_geojson 二选一）'),
        layer_b_geojson: geojsonSchema.optional(),
        ...includeGeojson,
      },
    },
    (args) => handleIntersect(store, args),
  )

  server.registerTool(
    'union',
    {
      title: '联合分析',
      description: `求 A、B 两个面图层的几何并集（turf union）。仅支持面图层。${VECTOR_OPS_DESC}`,
      inputSchema: {
        layer_a_id: z.string().optional().describe('图层 A 的数据集 ID（与 layer_a_geojson 二选一）'),
        layer_a_geojson: geojsonSchema.optional(),
        layer_b_id: z.string().optional().describe('图层 B 的数据集 ID（与 layer_b_geojson 二选一）'),
        layer_b_geojson: geojsonSchema.optional(),
        ...includeGeojson,
      },
    },
    (args) => handleUnion(store, args),
  )

  server.registerTool(
    'difference',
    {
      title: '差集分析',
      description: `求 A 减去 B 的几何差集（A 中每个要素分别减去全部 B 要素）。仅支持面图层。${VECTOR_OPS_DESC}`,
      inputSchema: {
        layer_a_id: z.string().optional().describe('图层 A（被减）的数据集 ID（与 layer_a_geojson 二选一）'),
        layer_a_geojson: geojsonSchema.optional(),
        layer_b_id: z.string().optional().describe('图层 B（减去的部分）的数据集 ID（与 layer_b_geojson 二选一）'),
        layer_b_geojson: geojsonSchema.optional(),
        ...includeGeojson,
      },
    },
    (args) => handleDifference(store, args),
  )

  server.registerTool(
    'clip',
    {
      title: '裁剪分析',
      description: `用裁剪图层裁剪目标图层：面×面取交集；点被面包含则保留。线要素暂不支持。${VECTOR_OPS_DESC}`,
      inputSchema: {
        ...layerRef,
        clip_layer_id: z.string().optional().describe('裁剪图层（面）的数据集 ID（与 clip_layer_geojson 二选一）'),
        clip_layer_geojson: geojsonSchema.optional(),
        ...includeGeojson,
      },
    },
    (args) => handleClip(store, args),
  )

  server.registerTool(
    'dissolve',
    {
      title: '融合分析',
      description: `按字段值（或不按字段）合并相邻/重叠面要素。${VECTOR_OPS_DESC}`,
      inputSchema: {
        ...layerRef,
        field: z.string().optional().describe('按该字段值分组融合；缺省时全部融合为一个要素'),
        ...includeGeojson,
      },
    },
    (args) => handleDissolve(store, args),
  )

  server.registerTool(
    'centroid',
    {
      title: '质心分析',
      description: `求每个要素的质心点（保留原属性）。${VECTOR_OPS_DESC}`,
      inputSchema: {
        ...layerRef,
        ...includeGeojson,
      },
    },
    (args) => handleCentroid(store, args),
  )

  server.registerTool(
    'bbox',
    {
      title: '最小外接矩形',
      description: `生成图层要素集合的最小外接矩形（一个 Polygon 要素）。${VECTOR_OPS_DESC}`,
      inputSchema: {
        ...layerRef,
        ...includeGeojson,
      },
    },
    (args) => handleBbox(store, args),
  )

  server.registerTool(
    'field_stats',
    {
      title: '字段统计',
      description: '对图层的数值字段做统计：计数、空值、求和、平均、最小、最大、标准差（样本）。',
      inputSchema: {
        ...layerRef,
        field: z.string().describe('要统计的数值字段名（可用 get_dataset 查看字段列表）'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleFieldStats(store, args),
  )

  server.registerTool(
    'layer_stats',
    {
      title: '图层统计',
      description: '图层整体统计：要素数、点/线/面数量、总面积 (m²)、总长度 (km)、外包矩形。',
      inputSchema: {
        ...layerRef,
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleLayerStats(store, args),
  )

  server.registerTool(
    'convert_format',
    {
      title: '格式转换',
      description:
        '把数据集或内联 GeoJSON 导出为 GeoJSON / CSV（点要素带 lon,lat 列，线面为 WKT 列）/ KML / GPX 文本，或 Shapefile（.zip 打包 shp+shx+dbf+prj+cpg）/ GeoPackage（.gpkg，SQLite），二进制格式以 base64 返回。文本格式可直接写入文件。',
      inputSchema: {
        ...layerRef,
        format: z.enum(['geojson', 'csv', 'kml', 'shp', 'gpx', 'gpkg']).describe('目标格式'),
        layer_name: z.string().optional().describe('导出文件基名（不含扩展名），默认用数据集名'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleConvertFormat(store, args),
  )

  server.registerTool(
    'raster_info',
    {
      title: '栅格信息',
      description: '读取本地栅格文件（GeoTIFF/PNG/JPEG 等）的元信息：尺寸、波段数、驱动、坐标系、四角经纬度。path=本地文件路径，或 data+name 传入文件内容。',
      inputSchema: {
        path: z.string().optional().describe('本地栅格文件路径'),
        data: z.string().optional().describe('文件内容（与 name 配合）'),
        name: z.string().optional().describe('文件名（含扩展名，用 data 时必填）'),
        encoding: z.enum(['utf8', 'base64']).optional().describe('data 的编码方式，默认 utf8'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleRasterInfo(store, args),
  )

  server.registerTool(
    'raster_translate',
    {
      title: '栅格转换（gdal_translate）',
      description: '用 GDAL 转换栅格格式/重采样（gdal_translate 参数，如 ["-of","PNG"] 转 PNG、["-of","GTiff","-outsize","50%","50%"] 缩小）。二进制结果以 base64 返回。',
      inputSchema: {
        path: z.string().optional().describe('本地栅格文件路径'),
        data: z.string().optional().describe('文件内容（与 name 配合）'),
        name: z.string().optional().describe('文件名（含扩展名，用 data 时必填）'),
        encoding: z.enum(['utf8', 'base64']).optional().describe('data 的编码方式，默认 utf8'),
        options: z.array(z.string()).describe('gdal_translate 命令行参数'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleRasterTranslate(store, args),
  )

  server.registerTool(
    'raster_warp',
    {
      title: '栅格重投影（gdalwarp）',
      description: '用 GDAL 重投影/配准栅格（gdalwarp 参数，如 ["-t_srs","EPSG:4326"]、["-of","GTiff"]）。二进制结果以 base64 返回。',
      inputSchema: {
        path: z.string().optional().describe('本地栅格文件路径'),
        data: z.string().optional().describe('文件内容（与 name 配合）'),
        name: z.string().optional().describe('文件名（含扩展名，用 data 时必填）'),
        encoding: z.enum(['utf8', 'base64']).optional().describe('data 的编码方式，默认 utf8'),
        options: z.array(z.string()).describe('gdalwarp 命令行参数'),
      },
      annotations: { readOnlyHint: true },
    },
    (args) => handleRasterWarp(store, args),
  )
}

export async function main(): Promise<void> {
  // GeoPackage 的 SQLite WASM：构建时复制到 dist/sql-wasm.wasm，随 server.cjs 分发
  const { configureGpkg } = await import('@/core/datasource/formats/gpkg')
  const { configureGdal } = await import('@/core/raster/gdalService')
  const fs = await import('node:fs')
  const path = await import('node:path')
  const wasmPath = path.join(__dirname, 'sql-wasm.wasm')
  configureGpkg({ wasmBytes: new Uint8Array(fs.readFileSync(wasmPath)) })
  // GDAL 的 wasm/data：构建时复制到 dist/，Node 端定位（打包后 node_modules 路径不可用）。
  // gdal3.js/node 的 getPreloadedPackage 会在路径前硬编码 './'，因此这里用相对 CWD 的路径
  configureGdal({
    wasmUrl: path.relative(process.cwd(), path.join(__dirname, 'gdal3WebAssembly.wasm')),
    dataUrl: path.relative(process.cwd(), path.join(__dirname, 'gdal3WebAssembly.data')),
    jsUrl: path.relative(process.cwd(), path.join(__dirname, 'gdal3.js')),
  })

  const server = new McpServer({ name: 'spatialharness', version: '0.1.0' })
  registerTools(server, new DatasetStore())
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('[spatialharness-mcp] 启动失败：', err)
  process.exit(1)
})
