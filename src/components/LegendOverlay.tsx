/**
 * 地图图例浮层：根据可见图层的符号化结果自动生成图例。
 * 与 PNG 导出共用 core/style/legend.collectLegendGroups，保证所见即所得。
 */
import { useProjectStore } from '@/state/project'
import { useUiStore } from '@/state/ui'
import { collectLegendGroups } from '@/core/style/legend'

export function LegendOverlay() {
  const visible = useUiStore((s) => s.legendVisible)
  const layers = useProjectStore((s) => s.layers)
  if (!visible) return null
  const groups = collectLegendGroups(layers)
  if (groups.length === 0) return null

  return (
    <div className="pointer-events-none absolute right-3 bottom-8 z-10 max-h-[45%] max-w-56 overflow-auto rounded-md border border-black/10 bg-white/85 px-2.5 py-2 shadow-md backdrop-blur-sm">
      {groups.map((g) => (
        <div key={g.layerName} className="mb-1.5 last:mb-0">
          <div className="mb-0.5 text-[11px] font-semibold text-gray-800">{g.layerName}</div>
          {g.items.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 py-px">
              {item.kind === 'point' ? (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/30"
                  style={{ backgroundColor: item.color }}
                />
              ) : item.kind === 'line' ? (
                <span className="inline-block h-0 w-3.5 shrink-0 border-t-2" style={{ borderColor: item.color }} />
              ) : (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] border border-black/30"
                  style={{ backgroundColor: item.color }}
                />
              )}
              {item.label && <span className="truncate text-[11px] text-gray-700">{item.label}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
