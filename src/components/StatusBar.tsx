/**
 * 底部状态栏：保存状态、磁盘连接、提示信息、坐标/比例尺/CRS、引擎信息。
 */
import { HardDrive, CloudOff, RefreshCcw, Loader2, AlertTriangle, CheckCircle2, Info, Database } from 'lucide-react'
import { useProjectStore } from '@/state/project'
import { useUiStore } from '@/state/ui'
import { useCursorStore } from '@/state/engineBridge'
import { formatCoord, zoomToScale, scaleLabel } from '@/core/geo/transform'
import { connectProjectFolder } from '@/state/persistence'
import { cn } from './ui/primitives'
import { getEngine } from '@/state/engineBridge'

function fmtTime(t: number | null): string {
  if (!t) return '—'
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

export function StatusBar() {
  const saveStatus = useProjectStore((s) => s.saveStatus)
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt)
  const diskConnected = useProjectStore((s) => s.diskConnected)
  const diskWritable = useProjectStore((s) => s.diskWritable)
  const view = useProjectStore((s) => s.view)
  const layers = useProjectStore((s) => s.layers)
  const busy = useUiStore((s) => s.busy)
  const statusMessage = useUiStore((s) => s.statusMessage)
  const cursor = useCursorStore()
  const engine = getEngine()

  const featureCount = layers.reduce((n, l) => n + (l.kind === 'vector' ? l.features.length : 0), 0)

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border bg-panel px-3 text-[11px] text-text-dim">
      {/* 保存状态 */}
      <div className="flex items-center gap-1.5">
        {saveStatus === 'saving' ? (
          <span className="flex items-center gap-1 text-warn">
            <Loader2 size={11} className="animate-spin" /> 保存中…
          </span>
        ) : saveStatus === 'disk' ? (
          <span className="flex items-center gap-1 text-ok">
            <CheckCircle2 size={11} /> 已保存到磁盘 {fmtTime(lastSavedAt)}
          </span>
        ) : saveStatus === 'idb-only' ? (
          <span className="flex items-center gap-1 text-warn">
            <CloudOff size={11} /> 已保存（仅浏览器内）
          </span>
        ) : saveStatus === 'error' ? (
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle size={11} /> 保存失败
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <CheckCircle2 size={11} className="text-ok" /> 自动保存已开启
          </span>
        )}
      </div>

      {/* 磁盘连接 */}
      {diskConnected && !diskWritable && (
        <button
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-warn hover:bg-panel-2"
          onClick={() => void connectProjectFolder()}
          title="浏览器重启后需重新授权文件夹访问"
        >
          <RefreshCcw size={11} /> 重新连接文件夹
        </button>
      )}
      {diskConnected && diskWritable && (
        <span className="flex items-center gap-1 text-text-faint" title="工程文件将自动写入本地磁盘">
          <HardDrive size={11} className="text-ok" /> 本地磁盘已连接
        </span>
      )}
      {!diskConnected && (
        <span className="hidden items-center gap-1 text-text-faint lg:flex" title="点击工具栏「存到本地」连接磁盘文件夹">
          <Database size={11} /> 仅浏览器工作区
        </span>
      )}

      {/* 忙碌 */}
      {busy && (
        <span className="flex items-center gap-1 text-accent">
          <Loader2 size={11} className="animate-spin" /> {busy.label}
        </span>
      )}

      {/* 提示 */}
      {statusMessage && (
        <span
          className={cn(
            'flex items-center gap-1 truncate',
            statusMessage.kind === 'ok' && 'text-ok',
            statusMessage.kind === 'warn' && 'text-warn',
            statusMessage.kind === 'error' && 'text-danger',
          )}
        >
          <Info size={11} />
          {statusMessage.text}
        </span>
      )}

      <div className="flex-1" />

      {/* 统计 */}
      <span className="hidden md:inline">
        {layers.length} 图层 · {featureCount} 要素
      </span>

      {/* 坐标 */}
      <span className="font-mono whitespace-nowrap">
        {Number.isFinite(cursor.lon)
          ? formatCoord(cursor.lon, cursor.lat)
          : '— —'}
      </span>

      {/* 比例尺 */}
      <span className="hidden whitespace-nowrap sm:inline">
        {view ? `${scaleLabel(zoomToScale(view.zoom))} · z${view.zoom.toFixed(1)}` : ''}
      </span>

      <span className="whitespace-nowrap text-text-faint">EPSG:3857</span>
      <span className="hidden whitespace-nowrap text-text-faint lg:inline">{engine?.displayName ?? ''}</span>
    </div>
  )
}
