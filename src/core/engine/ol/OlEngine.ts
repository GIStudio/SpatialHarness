/**
 * OpenLayers 引擎适配器（v1）：实现 MapEngine 接口。
 * 视图投影 EPSG:3857，业务几何 EPSG:4326（GeoJSON format 双向转换）。
 */
import OlMap from 'ol/Map'
import View from 'ol/View'
import Feature from 'ol/Feature'
import { toLonLat, transformExtent } from 'ol/proj'
import { unByKey } from 'ol/Observable'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { GeoJSON } from 'ol/format'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import { extend, type Extent } from 'ol/extent'
import { getUid } from 'ol/util'
import type { EventsKey } from 'ol/events'
import type { Layer } from 'ol/layer'
import type { Feature as GeoFeature } from 'geojson'
import type {
  BasemapId,
  DrawGeometryType,
  EngineEventMap,
  EngineFeature,
  ExportPngOptions,
  MapEngine,
  RasterLayerSpec,
  VectorLayerSpec,
  ViewState,
} from '../types'
import type { LayerStyle } from '@/core/style/types'
import { createStyleFunction, DRAW_STYLES } from './style'
import { buildRasterLayer } from './raster'
import { basemapEntry, createBasemapLayer } from './basemap'
import { exportMapPng } from './export'

type AnyHandler = (payload: never) => void

interface VectorEntry {
  layer: VectorLayer
  source: VectorSource
  style: LayerStyle
  interactive: boolean
}

export class OlEngine implements MapEngine {
  readonly id = 'ol'
  readonly displayName = 'OpenLayers'
  readonly capabilities = { draw: true, modify: true, raster: true, selection: true, identify: true }

  private map: OlMap | null = null
  private view: View | null = null
  /** dataProjection 4326 ⇄ featureProjection 3857 */
  private gj = new GeoJSON({ dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857' })
  private vectorLayers = new globalThis.Map<string, VectorEntry>()
  private rasterLayers = new globalThis.Map<string, { layer: Layer }>()
  private selection = new globalThis.Map<string, Set<string>>()
  private basemapId: BasemapId = 'none'
  private basemapLayer: Layer | null = null
  private draw: Draw | null = null
  private modify: Modify | null = null
  private listeners: (() => void)[] = []
  private handlers = new globalThis.Map<string, Set<AnyHandler>>()

  // ---------------- 事件 ----------------

  on<E extends keyof EngineEventMap>(event: E, handler: (payload: EngineEventMap[E]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set<AnyHandler>()
    const wrapped = handler as AnyHandler
    set.add(wrapped)
    this.handlers.set(event, set)
    return () => {
      set.delete(wrapped)
    }
  }

  private emit<E extends keyof EngineEventMap>(event: E, payload: EngineEventMap[E]): void {
    this.handlers.get(event)?.forEach((h) => h(payload as never))
  }

  // ---------------- 生命周期 ----------------

  mount(target: HTMLElement, options: { view: ViewState }): void {
    this.destroy()
    const view = new View({ projection: 'EPSG:3857', center: options.view.center, zoom: options.view.zoom })
    const map = new OlMap({ target, view, layers: [] })
    this.map = map
    this.view = view
    // 恢复底图（mount 重建地图时）
    if (this.basemapId !== 'none') {
      this.basemapLayer = createBasemapLayer(this.basemapId)
      if (this.basemapLayer) map.addLayer(this.basemapLayer)
    }
    const keys: EventsKey[] = []
    keys.push(
      map.on('singleclick', (evt) => {
        this.emit('click', {
          coordinate: this.toLonLatTuple(evt.coordinate),
          features: this.identify([evt.pixel[0], evt.pixel[1]]).map((f) => this.toEngineFeature(f)),
        })
      }),
    )
    keys.push(
      map.on('pointermove', (evt) => {
        this.emit('pointermove', { coordinate: this.toLonLatTuple(evt.coordinate) })
      }),
    )
    keys.push(map.on('moveend', () => this.emitViewChange()))
    keys.push(view.on('change:center', () => this.emitViewChange()))
    keys.push(view.on('change:resolution', () => this.emitViewChange()))
    this.listeners.push(() => keys.forEach(unByKey))
  }

  destroy(): void {
    this.cancelDraw()
    this.stopModify()
    for (const un of this.listeners) un()
    this.listeners = []
    this.handlers.clear()
    if (this.map) {
      this.map.setTarget(undefined)
      this.map = null
    }
    this.view = null
    this.vectorLayers.clear()
    this.rasterLayers.clear()
    this.selection.clear()
    this.basemapLayer = null
  }

  // ---------------- 底图与导出 ----------------

  setBasemap(id: BasemapId): void {
    this.basemapId = id
    if (this.basemapLayer) {
      this.map?.removeLayer(this.basemapLayer)
      this.basemapLayer = null
    }
    if (!this.map || id === 'none') return
    this.basemapLayer = createBasemapLayer(id)
    if (this.basemapLayer) this.map.addLayer(this.basemapLayer)
  }

  getBasemap(): BasemapId {
    return this.basemapId
  }

  exportPng(options: ExportPngOptions = {}): Promise<Blob> {
    if (!this.map) return Promise.reject(new Error('地图尚未挂载'))
    // 自动补上当前底图的版权说明
    const entry = basemapEntry(this.basemapId)
    const attribution = [options.attribution, entry?.attribution].filter(Boolean).join(' · ')
    return exportMapPng(this.map, { ...options, attribution: attribution || undefined })
  }

  // ---------------- 图层管理 ----------------

  addVectorLayer(spec: VectorLayerSpec): void {
    const olFeatures = this.toOlFeatures(spec.features, spec.id)
    const source = new VectorSource({ features: olFeatures })
    const layer = new VectorLayer({
      source,
      opacity: spec.opacity ?? 1,
      visible: spec.visible ?? true,
      zIndex: spec.zIndex ?? 0,
    })
    layer.set('__layerId', spec.id)
    this.vectorLayers.set(spec.id, { layer, source, style: spec.style, interactive: spec.interactive ?? true })
    this.applyStyle(spec.id)
    this.map?.addLayer(layer)
    this.emit('rendercomplete', { layerId: spec.id })
  }

  addRasterLayer(spec: RasterLayerSpec): void {
    const layer = buildRasterLayer(spec)
    this.rasterLayers.set(spec.id, { layer })
    this.map?.addLayer(layer)
    this.emit('rendercomplete', { layerId: spec.id })
  }

  removeLayer(id: string): void {
    const v = this.vectorLayers.get(id)
    if (v) {
      this.vectorLayers.delete(id)
      this.map?.removeLayer(v.layer)
    }
    const r = this.rasterLayers.get(id)
    if (r) {
      this.rasterLayers.delete(id)
      this.map?.removeLayer(r.layer)
    }
    this.selection.delete(id)
  }

  updateVectorData(id: string, features: GeoFeature[]): void {
    const entry = this.vectorLayers.get(id)
    if (!entry) return
    entry.source.clear()
    entry.source.addFeatures(this.toOlFeatures(features, id))
  }

  refreshLayer(id: string): void {
    this.vectorLayers.get(id)?.source.changed()
  }

  getLayerFeatures(id: string): GeoFeature[] {
    const entry = this.vectorLayers.get(id)
    if (!entry) return []
    return entry.source.getFeatures().map((f) => this.toGeoJsonFeature(f))
  }

  updateLayerStyle(id: string, style: LayerStyle): void {
    const entry = this.vectorLayers.get(id)
    if (!entry) return
    entry.style = style
    this.applyStyle(id)
  }

  setLayerVisible(id: string, visible: boolean): void {
    this.findLayer(id)?.setVisible(visible)
  }

  setLayerOpacity(id: string, opacity: number): void {
    this.findLayer(id)?.setOpacity(opacity)
  }

  setLayerZIndex(id: string, zIndex: number): void {
    this.findLayer(id)?.setZIndex(zIndex)
  }

  getLayerIds(): string[] {
    return [...this.vectorLayers.keys(), ...this.rasterLayers.keys()]
  }

  layerCount(): number {
    return this.vectorLayers.size + this.rasterLayers.size
  }

  // ---------------- 视图 ----------------

  getView(): ViewState {
    const view = this.view
    return {
      center: (view?.getCenter() ?? [0, 0]) as [number, number],
      zoom: view?.getZoom() ?? 0,
      rotation: view?.getRotation() ?? 0,
    }
  }

  setView(view: Partial<ViewState>, opts?: { animate?: boolean }): void {
    const v = this.view
    if (!v) return
    const update: { center?: [number, number]; zoom?: number; rotation?: number } = {}
    if (view.center) update.center = view.center
    if (view.zoom !== undefined) update.zoom = view.zoom
    if (view.rotation !== undefined) update.rotation = view.rotation
    if (Object.keys(update).length === 0) return
    v.animate({ ...update, duration: opts?.animate === false ? 0 : 250 })
    this.emitViewChange()
  }

  fitExtent(layerIds?: string[]): void {
    const view = this.view
    if (!view) return
    const ids = layerIds && layerIds.length > 0 ? layerIds : this.getLayerIds()
    let extent: Extent | undefined
    for (const id of ids) {
      const e = this.layerExtent(id)
      if (!e) continue
      extent = extent ? extend(extent, e) : e
    }
    if (!extent) {
      // 无数据：中国范围
      extent = transformExtent([73, 18, 135, 54], 'EPSG:4326', 'EPSG:3857')
    }
    view.fit(extent, { padding: [50, 50, 50, 50], maxZoom: 18 })
    this.emitViewChange()
  }

  // ---------------- 拾取与选择 ----------------

  identify(pixel: [number, number], opts?: { layerIds?: string[] }): GeoFeature[] {
    const map = this.map
    if (!map) return []
    const out: GeoFeature[] = []
    map.forEachFeatureAtPixel(
      pixel,
      (olFeature) => {
        const layerId = olFeature.get('__layerId') as string | undefined
        if (!layerId) return
        if (opts?.layerIds && !opts.layerIds.includes(layerId)) return
        if (olFeature instanceof Feature) {
          out.push(this.toGeoJsonFeature(olFeature))
        }
      },
      { hitTolerance: 6 },
    )
    return out
  }

  setSelection(layerId: string, featureIds: string[]): void {
    if (featureIds.length === 0) {
      this.selection.delete(layerId)
    } else {
      this.selection.set(layerId, new Set(featureIds))
    }
    if (this.vectorLayers.has(layerId)) this.applyStyle(layerId)
    this.emit('selectionchange', { layerId, featureIds })
  }

  clearSelection(): void {
    for (const layerId of [...this.selection.keys()]) {
      this.selection.delete(layerId)
      if (this.vectorLayers.has(layerId)) this.applyStyle(layerId)
      this.emit('selectionchange', { layerId, featureIds: [] })
    }
  }

  // ---------------- 编辑 ----------------

  startDraw(type: DrawGeometryType, layerId: string, onEnd: (feature: GeoFeature) => void): void {
    this.cancelDraw()
    const entry = this.vectorLayers.get(layerId)
    if (!entry) return
    const draw = new Draw({ source: entry.source, type, style: DRAW_STYLES[type] })
    draw.on('drawend', (evt) => {
      const gj = this.toGeoJsonFeature(evt.feature)
      onEnd(gj)
      this.emit('drawend', { layerId, feature: gj })
    })
    this.map?.addInteraction(draw)
    this.draw = draw
  }

  cancelDraw(): void {
    if (this.draw) {
      this.map?.removeInteraction(this.draw)
      this.draw = null
    }
  }

  startModify(layerId: string): void {
    this.stopModify()
    const entry = this.vectorLayers.get(layerId)
    if (!entry) return
    const modify = new Modify({ source: entry.source })
    modify.on('modifyend', (evt) => {
      const featureIds = evt.features.getArray().map((f) => String(f.getId() ?? getUid(f)))
      this.emit('modifyend', { layerId, featureIds })
    })
    this.map?.addInteraction(modify)
    this.modify = modify
  }

  stopModify(): void {
    if (this.modify) {
      this.map?.removeInteraction(this.modify)
      this.modify = null
    }
  }

  // ---------------- 内部工具 ----------------

  private findLayer(id: string): Layer | undefined {
    return this.vectorLayers.get(id)?.layer ?? this.rasterLayers.get(id)?.layer
  }

  private layerExtent(id: string): Extent | undefined {
    const v = this.vectorLayers.get(id)
    if (v) return v.source.getExtent() ?? undefined
    const r = this.rasterLayers.get(id)
    if (r) {
      const src = r.layer.getSource() as { getExtent?: () => Extent | undefined | null } | null
      return src?.getExtent?.() ?? undefined
    }
    return undefined
  }

  private toOlFeatures(features: GeoFeature[], layerId: string): Feature[] {
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features }
    const out = this.gj.readFeatures(fc) as Feature[]
    for (const f of out) {
      f.set('__layerId', layerId)
      if (f.getId() === undefined) f.setId(`f_${getUid(f)}`)
    }
    return out
  }

  /** ol feature → 4326 GeoJSON feature（保证 id） */
  private toGeoJsonFeature(olFeature: Feature): GeoFeature {
    const gj = this.gj.writeFeatureObject(olFeature)
    if (gj.id === undefined || gj.id === null) {
      gj.id = olFeature.getId() ?? `f_${getUid(olFeature)}`
    }
    return gj
  }

  /** geojson feature → 引擎无关要素视图 */
  private toEngineFeature(f: GeoFeature): EngineFeature {
    const props: Record<string, unknown> = {}
    let layerId = ''
    if (f.properties) {
      for (const [k, v] of Object.entries(f.properties)) {
        if (k === '__layerId') {
          layerId = String(v)
        } else {
          props[k] = v
        }
      }
    }
    return {
      id: String(f.id ?? ''),
      layerId,
      properties: props,
      geometry: f.geometry ?? null,
    }
  }

  private applyStyle(id: string): void {
    const entry = this.vectorLayers.get(id)
    if (!entry) return
    entry.layer.setStyle(createStyleFunction(entry.style, this.selection.get(id) ?? null))
  }

  private toLonLatTuple(coord: number[]): [number, number] {
    const [x, y] = toLonLat(coord as [number, number])
    return [x, y]
  }

  private emitViewChange(): void {
    const view = this.view
    if (!view) return
    this.emit('viewchange', {
      center: view.getCenter() as [number, number],
      zoom: view.getZoom() ?? 0,
      rotation: view.getRotation() ?? 0,
    })
  }
}
