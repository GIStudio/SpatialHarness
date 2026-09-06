import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPendingEdits, postEditResult } from './editClient'

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body } = handler(String(input), init)
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchPendingEdits', () => {
  it('携带 ack 游标并解析命令', async () => {
    const fn = mockFetch((url) => {
      expect(url).toContain('/edit/pending?ack=7')
      return { body: { commands: [{ id: 8, tool: 'map_status', args: {} }], latest: 8 } }
    })
    const out = await fetchPendingEdits(7)
    expect(out.latest).toBe(8)
    expect(out.commands[0].tool).toBe('map_status')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('非 200 抛错（供轮询循环判离线）', async () => {
    mockFetch(() => ({ status: 502, body: {} }))
    await expect(fetchPendingEdits(0)).rejects.toThrow('HTTP 502')
  })
})

describe('postEditResult', () => {
  it('成功时序列化 summary 字段', async () => {
    const fn = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toEqual({ id: 3, ok: true, summary: 'done' })
      return { body: {} }
    })
    await postEditResult(3, true, 'done')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('失败时序列化 error 字段', async () => {
    mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toEqual({ id: 3, ok: false, error: 'boom' })
      return { body: {} }
    })
    await postEditResult(3, false, 'boom')
  })
})
