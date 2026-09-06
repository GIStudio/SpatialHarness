/**
 * Python 分析区：通过本地桥（`spatialharness serve`）调用 pip 包 spatialharness
 * 的计算插件（可达性模型、街景元数据等），把重计算交给 Python。
 * - 桥离线时静默降级为提示 + 重试按钮，不影响面板其它功能
 * - GeoJSON 结果 → 新图层（复用矢量分析的结果图层流程）
 * - 行式表格结果 → 面板内表格；其它 JSON → flash 摘要
 */
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Terminal } from 'lucide-react'
import {
  Button,
  Checkbox,
  CollapseSection,
  Field,
  Select,
  Spinner,
  cn,
} from '@/components/ui/primitives'
import {
  checkBridge,
  contractHint,
  extractGeoJsonFeatures,
  extractTable,
  listPlugins,
  runPythonPlugin,
  type PythonPluginInfo,
} from '@/core/bridge/pythonBridge'
import { useProjectStore } from '@/state/project'
import { useSelectionStore } from '@/state/selection'
import { useUiStore } from '@/state/ui'
import { engineFitToLayer } from '@/state/engineBridge'
import { uid, inferLayerMeta, isVectorLayer, type VectorLayerModel } from '@/core/layers/model'
import { DEFAULT_PALETTE, type LayerStyle } from '@/core/style/types'

function defaultStyle(geometryType: ReturnType<typeof inferLayerMeta>['geometryType']): LayerStyle {
  const color = DEFAULT_PALETTE[0]
  if (geometryType === 'Point') {
    return { symbol: { kind: 'simple', pointSymbol: 'circle', pointRadius: 5, pointColor: color }, label: null }
  }
  if (geometryType === 'LineString') {
    return { symbol: { kind: 'simple', strokeColor: color, strokeWidth: 2 }, label: null }
  }
  return { symbol: { kind: 'simple', fillColor: color, strokeColor: color, strokeWidth: 1 }, label: null }
}

export default function PythonAnalysisSection() {
  const layers = useProjectStore((s) => s.layers)
  const addLayer = useProjectStore((s) => s.addLayer)
  const activeLayerId = useSelectionStore((s) => s.activeLayerId)
  const setActiveLayer = useSelectionStore((s) => s.setActiveLayer)
  const flash = useUiStore((s) => s.flash)

  const vectorLayers = useMemo(() => layers.filter(isVectorLayer), [layers])

  const [online, setOnline] = useState<boolean | null>(null) // null = 探测中
  const [plugins, setPlugins] = useState<Record<string, PythonPluginInfo>>({})
  const [pluginName, setPluginName] = useState('')
  const [layerId, setLayerId] = useState('')
  const [sendData, setSendData] = useState(true)
  const [paramsText, setParamsText] = useState('{}')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tableResult, setTableResult] = useState<{ columns: string[]; rows: (string | number | null)[][] } | null>(null)

  const probe = async () => {
    setOnline(null)
    const status = await checkBridge()
    setOnline(status.ok)
    if (status.ok) {
      try {
        setPlugins(await listPlugins())
      } catch {
        setPlugins({})
      }
    } else {
      setPlugins({})
    }
  }

  useEffect(() => {
    void probe()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时探测一次
  }, [])

  // 插件名失效回退；图层默认跟随当前激活图层
  useEffect(() => {
    setPluginName((prev) => (prev && plugins[prev] ? prev : (Object.keys(plugins)[0] ?? '')))
  }, [plugins])

  useEffect(() => {
    setLayerId((prev) => {
      if (prev && vectorLayers.some((l) => l.id === prev)) return prev
      if (activeLayerId && vectorLayers.some((l) => l.id === activeLayerId)) return activeLayerId
      return vectorLayers[0]?.id ?? ''
    })
  }, [vectorLayers, activeLayerId])

  const plugin = pluginName ? plugins[pluginName] : undefined
  const layer = vectorLayers.find((l) => l.id === layerId)

  const run = async () => {
    if (!plugin) return
    let params: Record<string, unknown>
    try {
      params = paramsText.trim() ? (JSON.parse(paramsText) as Record<string, unknown>) : {}
    } catch {
      setError('参数不是合法 JSON')
      return
    }
    setRunning(true)
    setError(null)
    setTableResult(null)
    try {
      const data = sendData && layer ? { type: 'FeatureCollection', features: layer.features } : null
      const result = await runPythonPlugin(plugin.name, data, params)

      const features = extractGeoJsonFeatures(result)
      if (features) {
        const meta = inferLayerMeta(features)
        const model: VectorLayerModel = {
          id: uid('lyr'),
          name: `Python_${plugin.name}${layer ? `_${layer.name}` : ''}`,
          kind: 'vector',
          geometryType: meta.geometryType,
          features,
          fields: meta.fields,
          style: defaultStyle(meta.geometryType),
          sourceCrs: 'EPSG:4326',
          visible: true,
          opacity: 1,
          zIndex: layers.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          editable: true,
        }
        addLayer(model)
        engineFitToLayer(model.id)
        setActiveLayer(model.id)
        flash(`Python 分析完成：${features.length} 个要素`, 'ok')
        return
      }

      const table = extractTable(result)
      if (table) {
        setTableResult(table)
        flash(`Python 分析完成：${table.rows.length} 行`, 'ok')
        return
      }

      const preview = JSON.stringify(result)
      flash(`完成（非空间结果）：${preview.length > 160 ? `${preview.slice(0, 160)}…` : preview}`, 'ok')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      flash(msg, 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <CollapseSection
      title={`Python 分析（${online ? '桥已连接' : online === null ? '探测中…' : '桥未连接'}）`}
      defaultOpen={false}
    >
      {online !== true ? (
        <div className="flex flex-col gap-2 py-1">
          <div className="flex items-start gap-2 rounded-md border border-border bg-panel-2 px-2 py-1.5 text-[11px] leading-relaxed text-text-dim">
            <Terminal size={13} className="mt-0.5 shrink-0 text-text-faint" />
            <span>
              在终端运行 <code className="rounded bg-panel-3 px-1 font-mono">spatialharness serve</code>{' '}
              （pip install spatialharness）即可把 Python 计算插件接入本工作台。
            </span>
          </div>
          <Button variant="default" size="sm" onClick={() => void probe()} icon={online === null ? <Spinner /> : <RefreshCw size={13} />}>
            重新探测
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 py-1">
          <Field label="插件">
            <Select
              value={pluginName}
              onChange={setPluginName}
              options={
                Object.keys(plugins).length
                  ? Object.values(plugins).map((p) => ({ value: p.name, label: `${p.name}（${p.category}）` }))
                  : [{ value: '', label: '（无已启用插件）' }]
              }
            />
          </Field>
          {plugin && (
            <>
              <p className="-mt-1 text-[11px] leading-relaxed text-text-faint">{plugin.description}</p>
              <p className={cn('-mt-1 font-mono text-[10px] text-text-faint')}>{contractHint(plugin)}</p>
            </>
          )}

          {vectorLayers.length > 0 && (
            <>
              <Field label="输入图层">
                <Select
                  value={layerId}
                  onChange={setLayerId}
                  options={vectorLayers.map((l) => ({ value: l.id, label: `${l.name}（${l.features.length} 要素）` }))}
                />
              </Field>
              <Checkbox
                checked={sendData}
                onChange={setSendData}
                label="把该图层作为 GeoJSON 传入（data）"
              />
            </>
          )}

          <Field label="参数（JSON，可选）">
            <textarea
              value={paramsText}
              onChange={(e) => setParamsText(e.target.value)}
              rows={2}
              spellCheck={false}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1 font-mono text-[11px] text-text outline-none focus:border-accent"
              placeholder='{"AccModel": "Gravity"}'
            />
          </Field>

          <Button variant="primary" size="sm" disabled={!plugin || running} onClick={() => void run()} icon={running ? <Spinner /> : <Terminal size={13} />}>
            {running ? '计算中…' : '在 Python 中运行'}
          </Button>

          {tableResult && (
            <div className="max-h-[200px] overflow-auto rounded-md border border-border bg-panel-2">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    {tableResult.columns.map((c) => (
                      <th key={c} className="sticky top-0 border-b border-border bg-panel-3 px-2 py-1 text-left font-medium whitespace-nowrap text-text-dim">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableResult.rows.map((row, i) => (
                    <tr key={i} className="odd:bg-panel-2/40">
                      {row.map((cell, j) => (
                        <td key={j} className="border-b border-border/40 px-2 py-1 whitespace-nowrap text-text-dim">
                          {cell === null || cell === undefined ? '' : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs break-words text-danger">
              {error}
            </div>
          )}
        </div>
      )}
    </CollapseSection>
  )
}
