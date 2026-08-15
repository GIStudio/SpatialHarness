/**
 * 地图视图组件：创建引擎实例并挂载，绑定引擎桥接层。
 * 组件本身不依赖具体引擎实现。
 */
import { useEffect, useRef } from 'react'
import { createDefaultEngine } from '@/core/engine/registry'
import { attachEngine, detachEngine } from '@/state/engineBridge'
import { useProjectStore } from '@/state/project'
import { useUiStore, isDrawTool } from '@/state/ui'
import { toWebMercator } from '@/core/geo/transform'

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const tool = useUiStore((s) => s.tool)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const engine = createDefaultEngine()
    const view = useProjectStore.getState().view
    engine.mount(el, {
      // 默认视图：中国范围
      view: view ?? { center: toWebMercator([104.5, 35.5]), zoom: 4 },
    })
    attachEngine(engine)
    return () => {
      detachEngine()
      engine.destroy()
    }
  }, [])

  // Esc 取消绘制/编辑
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const t = useUiStore.getState().tool
        if (isDrawTool(t) || t === 'modify') {
          useUiStore.getState().setTool('pan')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="absolute inset-0" ref={containerRef}>
      {isDrawTool(tool) && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-md bg-black/75 px-3 py-1.5 text-xs text-white shadow-lg">
          {tool === 'draw-point'
            ? '点击地图放置点要素'
            : tool === 'draw-line'
              ? '点击添加顶点，双击结束'
              : '点击添加顶点，双击闭合'}
          <span className="ml-1 text-white/50">· Esc 取消</span>
        </div>
      )}
    </div>
  )
}
