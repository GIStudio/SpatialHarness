/**
 * 示例库对话框：列出全部标准 demo 场景，一键载入（数据 + 自动符号化 + 底图 + 视图）。
 */
import { Map, Tag } from 'lucide-react'
import { Modal, cn } from './ui/primitives'
import { DEMO_SCENARIOS } from '@/core/demo/scenarios'
import { loadDemoScenario } from '@/state/demo'
import { useUiStore } from '@/state/ui'

export function DemoGallery({ onClose }: { onClose: () => void }) {
  const busy = useUiStore((s) => s.busy)

  const load = async (id: string) => {
    const ok = await loadDemoScenario(id)
    if (ok) onClose()
  }

  return (
    <Modal title="示例库：标准 demo 场景" onClose={onClose} width={640}>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void load(s.id)}
            className={cn(
              'flex flex-col gap-1.5 rounded-lg border border-border bg-panel-2 p-3 text-left transition-colors',
              'hover:border-accent hover:bg-panel-3 disabled:opacity-40',
            )}
          >
            <div className="flex items-center gap-1.5">
              <Map size={14} className="shrink-0 text-accent" />
              <span className="truncate text-xs font-medium text-text">{s.title}</span>
            </div>
            <p className="line-clamp-2 text-[11px] leading-relaxed text-text-dim">{s.description}</p>
            <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
              <Tag size={10} className="text-text-faint" />
              {s.tags.map((t) => (
                <span key={t} className="rounded bg-panel-3 px-1.5 py-0.5 text-[10px] text-text-dim">
                  {t}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-text-faint">
        示例数据来自 Natural Earth（公共领域）与 USGS（美国政府公有领域），存于仓库 demo/data/，随应用本地加载。
        载入示例会新建同名工程，不影响其他已保存工程。
      </p>
    </Modal>
  )
}
