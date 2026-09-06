import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkBridge,
  contractHint,
  extractGeoJsonFeatures,
  extractTable,
  listPlugins,
  runPythonPlugin,
} from './pythonBridge'

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const payload = handler(url, init)
    const status = payload instanceof Error ? 500 : 200
    const body = payload instanceof Error ? { error: payload.message } : payload
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('checkBridge', () => {
  it('在线时返回版本', async () => {
    mockFetch((url) => (url.endsWith('/health') ? { ok: true, version: '0.2.0' } : new Error('not found')))
    expect(await checkBridge('http://x')).toEqual({ ok: true, version: '0.2.0' })
  })

  it('网络异常时静默降级为 {ok:false}', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await checkBridge('http://x')).toEqual({ ok: false })
  })
})

describe('listPlugins / runPythonPlugin', () => {
  it('列出插件 manifest', async () => {
    const fetchMock = mockFetch((url) =>
      url.endsWith('/plugins')
        ? { street_solar: { name: 'street_solar', version: '0.0.10', category: 'streetview', description: '', input_contract: { folder: 'path' }, output_contract: { metadata: 'table' } } }
        : new Error('not found'),
    )
    const plugins = await listPlugins('http://x')
    expect(plugins['street_solar'].input_contract).toEqual({ folder: 'path' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('POST /run 携带 data 与 params 并返回 result', async () => {
    const fetchMock = mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { data: unknown; params: Record<string, unknown> }
      return { ok: true, result: { echoed: body } }
    })
    const result = (await runPythonPlugin('hello', { type: 'FeatureCollection', features: [] }, { who: 'web' }, 'http://x')) as {
      echoed: { data: { type: string }; params: { who: string } }
    }
    expect(result.echoed.data.type).toBe('FeatureCollection')
    expect(result.echoed.params).toEqual({ who: 'web' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://x/run/hello')
    expect(init.method).toBe('POST')
  })

  it('服务端报错时抛出 error 字段', async () => {
    mockFetch(() => new Error('boom'))
    await expect(runPythonPlugin('x', null, {}, 'http://x')).rejects.toThrow('boom')
  })
})

describe('结果提取', () => {
  const feature = { type: 'Feature' as const, properties: { a: 1 }, geometry: { type: 'Point' as const, coordinates: [0, 0] } }

  it('顶层 GeoJSON FeatureCollection → 要素数组', () => {
    const out = extractGeoJsonFeatures({ type: 'FeatureCollection', format: 'geojson', features: [feature] })
    expect(out).toHaveLength(1)
  })

  it('嵌套在结果对象值域中的 GeoJSON 也能提取（首个命中）', () => {
    const out = extractGeoJsonFeatures({ summary: { format: 'records' }, geometry: { type: 'FeatureCollection', features: [feature, feature] } })
    expect(out).toHaveLength(2)
  })

  it('records 表格 → AnalysisTableResult', () => {
    const table = extractTable({ result: { format: 'records', columns: ['a', 'b'], rows: [[1, 'x'], [2, null]] } })
    expect(table).toEqual({ columns: ['a', 'b'], rows: [[1, 'x'], [2, null]] })
  })

  it('无空间/表格结果时返回 null', () => {
    expect(extractGeoJsonFeatures({ foo: 1 })).toBeNull()
    expect(extractTable({ foo: 1 })).toBeNull()
  })
})

describe('contractHint', () => {
  it('拼接输入输出契约', () => {
    expect(
      contractHint({
        name: 'x',
        version: '0',
        category: 'c',
        description: '',
        input_contract: { data: 'table' },
        output_contract: { accessibility: 'table', summary: 'table' },
      }),
    ).toBe('输入: data=table · 输出: accessibility=table, summary=table')
  })
})
