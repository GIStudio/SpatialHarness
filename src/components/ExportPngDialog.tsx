/**
 * PNG 导出对话框：图题 / 图例开关 / 分辨率倍数。
 * 图例内容来自当前图层的符号化结果（core/style/legend.collectLegendGroups），
 * 与地图图例浮层同源。
 */
import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button, Field, Modal, Select, TextInput, Toggle } from './ui/primitives'
import { getEngine } from '@/state/engineBridge'
import { useProjectStore } from '@/state/project'
import { useUiStore } from '@/state/ui'
import { collectLegendGroups } from '@/core/style/legend'

export function ExportPngDialog({ onClose }: { onClose: () => void }) {
  const projectName = useProjectStore((s) => s.projectName)
  const [title, setTitle] = useState(projectName.replace(/^示例：/, ''))
  const [withLegend, setWithLegend] = useState(true)
  const [scale, setScale] = useState('2')
  const [exporting, setExporting] = useState(false)
  const flash = useUiStore((s) => s.flash)

  const doExport = async () => {
    const engine = getEngine()
    if (!engine) {
      flash('地图尚未就绪', 'error')
      return
    }
    setExporting(true)
    try {
      const layers = useProjectStore.getState().layers
      const blob = await engine.exportPng({
        title: title.trim() || undefined,
        legends: withLegend ? collectLegendGroups(layers) : undefined,
        scale: scale === '2' ? 2 : 1,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(title.trim() || projectName || 'map').replace(/[\\/:*?"<>|]/g, '_')}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      flash('PNG 已导出', 'ok')
      onClose()
    } catch (e) {
      flash(e instanceof Error ? e.message : '导出失败', 'error')
    } finally {
      setExporting(false)
    }
  }

  return (
    <Modal
      title="导出地图为 PNG"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" icon={<Download size={14} />} disabled={exporting} onClick={() => void doExport()}>
            {exporting ? '导出中…' : '导出'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="图题（绘制在图像顶部，可留空）">
          <TextInput value={title} onChange={setTitle} placeholder="例如：世界人口分布图" />
        </Field>
        <Field label="分辨率">
          <Select
            value={scale}
            onChange={setScale}
            options={[
              { value: '1', label: '1x（屏幕分辨率）' },
              { value: '2', label: '2x（高清）' },
            ]}
          />
        </Field>
        <Toggle checked={withLegend} onChange={setWithLegend} label="包含图例（按当前图层符号化自动生成）" />
        <p className="text-[11px] leading-relaxed text-text-faint">
          底图版权说明会自动附加在图像左下角。若导出失败并提示跨域污染，请确认使用的在线底图支持 CORS。
        </p>
      </div>
    </Modal>
  )
}
