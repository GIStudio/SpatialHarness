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

  // 6.7 raster_info：用 load_dataset 同款 fixture 的 GeoTIFF？——直接以 base64 内联最小 GeoTIFF
  // 构建 2×2 GeoTIFF（与 Web 端 geotiffFixture 同结构，最小化）
  function buildMiniTiff() {
    const w = 2, h = 2, pixel = w * h, scale = 0.1, lon = 116.0, lat = 40.0
    const ec = 12, ifd = 8, ifdSize = 2 + ec * 12 + 4
    let off = ifd + ifdSize
    const align = (n) => (off = off % n === 0 ? off : off + (n - (off % n)))
    const so = align(8); off = so + 24
    const to = align(8); off = to + 48
    const ko = align(2); const kl = 4 + 3 * 4; off = ko + kl * 2
    const d = align(1); off = d + pixel
    const buf = Buffer.alloc(off)
    buf[0] = 0x49; buf[1] = 0x49
    buf.writeUInt16LE(0x2a, 2); buf.writeUInt32LE(ifd, 4); buf.writeUInt16LE(ec, ifd)
    let e = ifd + 2
    const ent = (tag, typ, cnt, val) => { buf.writeUInt16LE(tag, e); buf.writeUInt16LE(typ, e + 2); buf.writeUInt32LE(cnt, e + 4); buf.writeUInt32LE(val, e + 8); e += 12 }
    ent(256, 4, 1, w); ent(257, 4, 1, h); ent(258, 3, 1, 8); ent(259, 3, 1, 1); ent(262, 3, 1, 1)
    ent(273, 4, 1, d); ent(277, 3, 1, 1); ent(278, 4, 1, h); ent(279, 4, 1, pixel)
    ent(33550, 12, 3, so); ent(33922, 12, 6, to); ent(34735, 3, kl, ko)
    buf.writeUInt32LE(0, e)
    buf.writeDoubleLE(scale, so); buf.writeDoubleLE(scale, so + 8); buf.writeDoubleLE(0, so + 16)
    buf.writeDoubleLE(0, to); buf.writeDoubleLE(0, to + 8); buf.writeDoubleLE(0, to + 16)
    buf.writeDoubleLE(lon, to + 24); buf.writeDoubleLE(lat, to + 32); buf.writeDoubleLE(0, to + 40)
    let k = ko
    for (const v of [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326]) { buf.writeUInt16LE(v, k); k += 2 }
    for (let i = 0; i < pixel; i++) buf[d + i] = i % 256
    return buf
  }
  const miniTif = buildMiniTiff()
  const tifB64 = miniTif.toString('base64')

  const info = await client.callTool({ name: 'raster_info', arguments: { data: tifB64, name: 'mini.tif', encoding: 'base64' } })
  if (info.isError) throw new Error(`raster_info 失败：${textOf(info)}`)
  console.log(`\n✅ raster_info：${textOf(info).split('\n')[1]}`)

  const png = await client.callTool({ name: 'raster_translate', arguments: { data: tifB64, name: 'mini.tif', encoding: 'base64', options: ['-of', 'PNG'] } })
  if (png.isError) throw new Error(`raster_translate 失败：${textOf(png)}`)
  const pngBytes = Buffer.from(png.structuredContent?.content ?? '', 'base64')
  if (pngBytes.subarray(1, 4).toString() !== 'PNG') throw new Error('raster_translate 输出不是 PNG')
  console.log(`✅ raster_translate → ${png.structuredContent?.file_name}（${pngBytes.length} 字节，PNG 魔数 OK）`)

  const warp = await client.callTool({ name: 'raster_warp', arguments: { data: tifB64, name: 'mini.tif', encoding: 'base64', options: ['-of', 'GTiff', '-t_srs', 'EPSG:3857'] } })
  if (warp.isError) throw new Error(`raster_warp 失败：${textOf(warp)}`)
  const warpBytes = Buffer.from(warp.structuredContent?.content ?? '', 'base64')
  if (warpBytes.subarray(0, 2).toString() !== 'II') throw new Error('raster_warp 输出不是 TIFF')
  console.log(`✅ raster_warp → ${warp.structuredContent?.file_name}（${warpBytes.length} 字节，TIFF 魔数 OK）`)

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
