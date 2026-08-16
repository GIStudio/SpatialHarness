/**
 * 最小 ZIP 写入器（stored 存储，不压缩）：
 * 用于 Shapefile 导出打包（.shp/.shx/.dbf/.prj/.cpg → .zip）。
 * 零依赖、纯字节操作，可在 Web Worker 与 Node 中运行。
 *
 * 支持标准 ZIP 读取器（JSZip / unzip / Finder / Explorer）：
 * - Local File Header + Central Directory + EOCD 三段结构
 * - 文件名按 UTF-8 编码并置 General Purpose Bit 11（中文图层名安全）
 */

/* ------------------------------ CRC32 ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/* ------------------------------ DOS 时间 ------------------------------ */

function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f)
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f)
  return { time, date }
}

/* ------------------------------ 写入 ------------------------------ */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** 把若干条目打包为 stored（不压缩）ZIP 文件字节 */
export function zipStore(entries: ZipEntry[], now: Date = new Date()): Uint8Array {
  const enc = new TextEncoder()
  const { time, date } = dosDateTime(now)

  interface Prepared {
    nameBytes: Uint8Array
    crc: number
    offset: number
    data: Uint8Array
  }
  const prepared: Prepared[] = []

  // 第一遍：计算各条目 local header 偏移与总长
  let localSize = 0
  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    prepared.push({ nameBytes, crc: crc32(e.data), offset: localSize, data: e.data })
    localSize += 30 + nameBytes.length + e.data.length
  }
  const centralSize = prepared.reduce((s, p) => s + 46 + p.nameBytes.length, 0)
  const total = localSize + centralSize + 22

  const out = new Uint8Array(total)
  const dv = new DataView(out.buffer)
  let off = 0

  // Local File Header + 数据
  for (const p of prepared) {
    dv.setUint32(off, 0x04034b50, true) // signature
    dv.setUint16(off + 4, 20, true) // version needed
    dv.setUint16(off + 6, 0x0800, true) // flags: UTF-8 文件名
    dv.setUint16(off + 8, 0, true) // method: stored
    dv.setUint16(off + 10, time, true)
    dv.setUint16(off + 12, date, true)
    dv.setUint32(off + 14, p.crc, true)
    dv.setUint32(off + 18, p.data.length, true) // compressed size
    dv.setUint32(off + 22, p.data.length, true) // uncompressed size
    dv.setUint16(off + 26, p.nameBytes.length, true)
    dv.setUint16(off + 28, 0, true) // extra len
    out.set(p.nameBytes, off + 30)
    out.set(p.data, off + 30 + p.nameBytes.length)
    off += 30 + p.nameBytes.length + p.data.length
  }

  // Central Directory
  const centralOffset = off
  for (const p of prepared) {
    dv.setUint32(off, 0x02014b50, true) // signature
    dv.setUint16(off + 4, 20, true) // version made by
    dv.setUint16(off + 6, 20, true) // version needed
    dv.setUint16(off + 8, 0x0800, true) // flags
    dv.setUint16(off + 10, 0, true) // method
    dv.setUint16(off + 12, time, true)
    dv.setUint16(off + 14, date, true)
    dv.setUint32(off + 16, p.crc, true)
    dv.setUint32(off + 20, p.data.length, true)
    dv.setUint32(off + 24, p.data.length, true)
    dv.setUint16(off + 28, p.nameBytes.length, true)
    dv.setUint16(off + 30, 0, true) // extra len
    dv.setUint16(off + 32, 0, true) // comment len
    dv.setUint16(off + 34, 0, true) // disk number
    dv.setUint16(off + 36, 0, true) // internal attrs
    dv.setUint32(off + 38, 0, true) // external attrs
    dv.setUint32(off + 42, p.offset, true) // local header offset
    out.set(p.nameBytes, off + 46)
    off += 46 + p.nameBytes.length
  }

  // End of Central Directory
  dv.setUint32(off, 0x06054b50, true)
  dv.setUint16(off + 4, 0, true) // disk
  dv.setUint16(off + 6, 0, true) // cd disk
  dv.setUint16(off + 8, entries.length, true)
  dv.setUint16(off + 10, entries.length, true)
  dv.setUint32(off + 12, centralSize, true)
  dv.setUint32(off + 16, centralOffset, true)
  dv.setUint16(off + 20, 0, true) // comment len

  return out
}
