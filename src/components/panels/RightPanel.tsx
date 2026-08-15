/**
 * 右侧停靠面板：属性表 / 样式 / 分析 三个标签页。
 */
import { Table2, Palette, FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'
import { useUiStore, type RightTab } from '@/state/ui'
import { cn } from '../ui/primitives'
import { AttributeTablePanel } from './AttributeTablePanel'
import StylePanel from './StylePanel'
import AnalysisPanel from './AnalysisPanel'

const TABS: { id: RightTab; label: string; icon: ReactNode }[] = [
  { id: 'attributes', label: '属性表', icon: <Table2 size={13} /> },
  { id: 'style', label: '样式', icon: <Palette size={13} /> },
  { id: 'analysis', label: '分析', icon: <FlaskConical size={13} /> },
]

export function RightPanel() {
  const tab = useUiStore((s) => s.rightTab)
  const setTab = useUiStore((s) => s.setRightTab)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-xs transition-colors',
              tab === t.id
                ? 'bg-panel-3 font-medium text-text'
                : 'text-text-dim hover:bg-panel-2 hover:text-text',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden pt-1.5">
        {tab === 'attributes' && <AttributeTablePanel />}
        {tab === 'style' && <StylePanel />}
        {tab === 'analysis' && <AnalysisPanel />}
      </div>
    </div>
  )
}
