/**
 * MCP 冒烟测试：以真实 MCP 客户端通过 stdio 连接服务器，
 * 验证 initialize → tools/list → 工具调用全链路。
 *
 * 运行：pnpm --filter @spatial-harness/mcp-server smoke
 * （需先 build 生成 dist/server.cjs）
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.resolve(here, '..', 'dist', 'server.cjs')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
})

const client = new Client({ name: 'spatialharness-smoke', version: '0.0.1' })

function textOf(result) {
  return result.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

try {
  await client.connect(transport)

  // 1. initialize + tools/list
  const tools = await client.listTools()
  const names = tools.tools.map((t) => t.name)
  console.log(`✅ 连接成功，发现 ${names.length} 个工具：`)
  console.log(`   ${names.join(', ')}`)

  // 2. load_dataset：内联 GeoJSON
  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'A', pop: 100 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
              [0, 0],
            ],
          ],
        },
      },
      {
        type: 'Feature',
        properties: { name: 'B', pop: 300 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [20, 20],
              [30, 20],
              [30, 30],
              [20, 30],
              [20, 20],
            ],
          ],
        },
      },
    ],
  })
  const loaded = await client.callTool({ name: 'load_dataset', arguments: { name: 'demo.geojson', data: geojson } })
  console.log(`\n✅ load_dataset：\n${textOf(loaded)}`)
  const layerId = loaded.structuredContent?.loaded?.[0]?.layer_id ?? 'L1'

  // 3. buffer
  const buffered = await client.callTool({
    name: 'buffer',
    arguments: { layer_id: layerId, distance: 1, unit: 'kilometers' },
  })
  console.log(`\n✅ buffer：\n${textOf(buffered)}`)
  const resultId = buffered.structuredContent?.layer_id

  // 4. layer_stats
  const stats = await client.callTool({ name: 'layer_stats', arguments: { layer_id: resultId } })
  console.log(`\n✅ layer_stats：\n${textOf(stats)}`)

  // 5. field_stats
  const fieldStats = await client.callTool({ name: 'field_stats', arguments: { layer_id: layerId, field: 'pop' } })
  console.log(`\n✅ field_stats：\n${textOf(fieldStats)}`)

  // 6. convert_format → KML
  const kml = await client.callTool({ name: 'convert_format', arguments: { layer_id: layerId, format: 'kml' } })
  console.log(`\n✅ convert_format（前 300 字符）：\n${textOf(kml).slice(0, 300)}`)

  // 6.5 convert_format → GeoPackage（base64，校验 SQLite 魔数）
  const gpkg = await client.callTool({ name: 'convert_format', arguments: { layer_id: layerId, format: 'gpkg' } })
  const gpkgB64 = gpkg.structuredContent?.content ?? ''
  const gpkgBytes = Buffer.from(gpkgB64, 'base64')
  if (gpkg.isError || gpkgBytes.subarray(0, 2).toString() !== 'SQ') {
    throw new Error(`convert_format gpkg 失败：${textOf(gpkg).slice(0, 200)}`)
  }
  console.log(`\n✅ convert_format → gpkg：${gpkgBytes.length} 字节（SQLite 魔数 OK）`)

  // 7. list_datasets（无参数工具需显式传空对象）
  const list = await client.callTool({ name: 'list_datasets', arguments: {} })
  console.log(`\n✅ list_datasets：\n${textOf(list)}`)

  // 8. 错误路径：不存在的数据集
  const bad = await client.callTool({ name: 'buffer', arguments: { layer_id: 'L99', distance: 1 } })
  console.log(`\n✅ 错误路径（期望报错）：${bad.isError ? 'isError=true' : '未报错！'}`)
  console.log(`   ${textOf(bad)}`)

  console.log('\n🎉 冒烟测试全部通过')
} finally {
  await client.close()
  await transport.close()
}
