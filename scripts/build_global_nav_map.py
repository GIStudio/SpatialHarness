#!/usr/bin/env python3
"""Build a fully self-contained interactive HTML map of a navigation-graph GeoJSON.

Inlines the OpenLayers UMD bundle (node_modules/ol/dist/ol.js) and the raw
GeoJSON payload so the result works offline from file:// with no server.

Usage:
    python3 scripts/build_global_nav_map.py \
        <input.geojson> [output.html] [ol.js]
"""

import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent

APP_JS = r"""
// ===================== data =====================
const DATA = __DATA__;

// ===================== parse =====================
const fmt = new ol.format.GeoJSON();
const byType = { node: [], edge: [], poi: [] };
const allFeatures = fmt.readFeatures(DATA, {
  dataProjection: "EPSG:4326",
  featureProjection: "EPSG:3857",
});
for (const f of allFeatures) {
  const p = f.getProperties();
  if (p.id) f.setId(String(p.id));
  if (byType[p.type]) byType[p.type].push(f);
}
const NODE = byType.node, EDGE = byType.edge, POI = byType.poi;

// ===================== styles =====================
const EDGE_STYLE = {
  walk:             { color: "#2563eb", width: 1.8, dash: null,      label: "步行道" },
  stairs:           { color: "#f97316", width: 2.0, dash: [10, 6],   label: "楼梯" },
  elevator_vertical:{ color: "#dc2626", width: 2.6, dash: null,      label: "垂直电梯" },
  elevator_slanted: { color: "#a855f7", width: 2.6, dash: [6, 4],    label: "斜梯" },
  gate:             { color: "#059669", width: 2.6, dash: null,      label: "门 / 闸口" },
};
function edgeSpec(t) { return EDGE_STYLE[t] || EDGE_STYLE.walk; }

let hoverId = null;
let showPoiLabels = true;

function edgeStyle(f) {
  const s = edgeSpec(f.get("edge_type"));
  const hover = f.getId() === hoverId;
  return new ol.style.Style({
    stroke: new ol.style.Stroke({
      color: hover ? "#0f172a" : s.color,
      width: hover ? s.width + 3 : s.width,
      lineDash: s.dash,
      lineCap: "round",
      lineJoin: "round",
    }),
  });
}
function nodeStyle(f) {
  const hover = f.getId() === hoverId;
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: hover ? 6 : 3.2,
      fill: new ol.style.Fill({ color: hover ? "#0f172a" : "#334155" }),
      stroke: new ol.style.Stroke({ color: "#ffffff", width: 1.1 }),
    }),
  });
}
function poiStyle(f) {
  const hover = f.getId() === hoverId;
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: hover ? 10 : 7,
      fill: new ol.style.Fill({ color: "#e11d48" }),
      stroke: new ol.style.Stroke({ color: "#ffffff", width: 2 }),
    }),
    text: showPoiLabels
      ? new ol.style.Text({
          text: f.get("name") || f.get("id"),
          font: '600 13px "PingFang SC","Noto Sans CJK SC","Microsoft YaHei",sans-serif',
          fill: new ol.style.Fill({ color: "#1f2937" }),
          stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 }),
          offsetY: -15,
          textAlign: "center",
          textBaseline: "bottom",
        })
      : undefined,
  });
}

// ===================== layers =====================
const edgeLayer = new ol.layer.Vector({ source: new ol.source.Vector({ features: EDGE }), style: edgeStyle, zIndex: 3 });
const nodeLayer = new ol.layer.Vector({ source: new ol.source.Vector({ features: NODE }), style: nodeStyle, zIndex: 4 });
const poiLayer  = new ol.layer.Vector({ source: new ol.source.Vector({ features: POI }),  style: poiStyle,  zIndex: 5, declutter: true });

const tileLayers = {
  osm:   new ol.layer.Tile({ source: new ol.source.OSM(), zIndex: 1 }),
  light: new ol.layer.Tile({ source: new ol.source.XYZ({
           url: "https://{a-d}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
           attributions: "© OpenStreetMap contributors © CARTO", crossOrigin: "anonymous", maxZoom: 20 }), zIndex: 1 }),
  dark:  new ol.layer.Tile({ source: new ol.source.XYZ({
           url: "https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
           attributions: "© OpenStreetMap contributors © CARTO", crossOrigin: "anonymous", maxZoom: 20 }), zIndex: 1 }),
};
Object.values(tileLayers).forEach(l => l.setVisible(false));

// ===================== map =====================
const view = new ol.View({ projection: "EPSG:3857" });
const defaultControls = (ol.control.defaults && ol.control.defaults.defaults)
  ? ol.control.defaults.defaults : ol.control.defaults;
const map = new ol.Map({
  target: "map",
  layers: [...Object.values(tileLayers), edgeLayer, nodeLayer, poiLayer],
  view,
  controls: defaultControls({ attributionOptions: { collapsible: false } })
    .extend([new ol.control.ScaleLine(), new ol.control.FullScreen()]),
});

function fitAll() {
  const ext = new ol.source.Vector({ features: allFeatures }).getExtent();
  view.fit(ext, { padding: [64, 330, 64, 64], maxZoom: 18 });
}
fitAll();

// ===================== interaction =====================
const tooltip = document.getElementById("tooltip");
const statusCoord = document.getElementById("status-coord");
const infobox = document.getElementById("infobox");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

map.on("pointermove", evt => {
  if (evt.dragging) return;
  const coord = ol.proj.toLonLat(evt.coordinate);
  statusCoord.textContent = coord[0].toFixed(6) + ", " + coord[1].toFixed(6);
  const feat = map.forEachFeatureAtPixel(evt.pixel, f => f, { hitTolerance: 8 });
  const id = feat ? feat.getId() : null;
  if (id !== hoverId) { hoverId = id; map.render(); }
  if (feat) {
    const p = feat.getProperties();
    let lines;
    if (p.type === "edge") lines = ["边 " + p.u + " → " + p.v, edgeSpec(p.edge_type).label + " · " + (p.edge_type || "")];
    else if (p.type === "node") lines = ["节点 " + (p.id || ""), "node_type: " + (p.node_type || "")];
    else lines = [p.name || "", "POI · " + (p.id || "")];
    tooltip.innerHTML = lines.map(l => "<div>" + escapeHtml(l) + "</div>").join("");
    tooltip.style.display = "block";
    tooltip.style.left = (evt.pixel[0] + 14) + "px";
    tooltip.style.top = (evt.pixel[1] + 14) + "px";
  } else {
    tooltip.style.display = "none";
  }
});

map.on("singleclick", evt => {
  const feat = map.forEachFeatureAtPixel(evt.pixel, f => f, { hitTolerance: 6 });
  showInfo(feat);
});

function showInfo(feat) {
  if (!feat) { infobox.style.display = "none"; return; }
  const p = feat.getProperties();
  const c = ol.proj.toLonLat(ol.extent.getCenter(feat.getGeometry().getExtent()));
  const rows = [];
  const add = (k, v) => rows.push('<tr><td class="k">' + escapeHtml(k) + "</td><td>" + escapeHtml(v) + "</td></tr>");
  add("类型", { node: "导航节点", edge: "导航边", poi: "兴趣点" }[p.type] || p.type);
  add("ID", p.id || "");
  if (p.type === "edge") {
    add("起点 u", p.u); add("终点 v", p.v);
    add("边类型", (p.edge_type || "") + "（" + (edgeSpec(p.edge_type).label) + "）");
  }
  if (p.type === "node") add("node_type", p.node_type || "");
  if (p.type === "poi") add("名称", p.name || "");
  if (p.map_slug) add("地图", p.map_slug);
  add("WGS84 坐标", c[0].toFixed(6) + ", " + c[1].toFixed(6));
  infobox.querySelector(".ib-body").innerHTML =
    '<table>' + rows.join("") + "</table>";
  infobox.style.display = "block";
}
document.getElementById("ib-close").addEventListener("click", () => { infobox.style.display = "none"; });

// ===================== panel wiring =====================
function bindLayer(chkId, layer) {
  document.getElementById(chkId).addEventListener("change", e => layer.setVisible(e.target.checked));
}
bindLayer("chk-edge", edgeLayer);
bindLayer("chk-node", nodeLayer);
bindLayer("chk-poi", poiLayer);
document.getElementById("chk-label").addEventListener("change", e => {
  showPoiLabels = e.target.checked;
  map.render();
});
document.querySelectorAll('input[name="basemap"]').forEach(r => {
  r.addEventListener("change", () => {
    Object.entries(tileLayers).forEach(([k, l]) => l.setVisible(r.value === k));
  });
});
document.getElementById("btn-fit").addEventListener("click", fitAll);
document.getElementById("btn-info-clear").addEventListener("click", () => { infobox.style.display = "none"; });

// ===================== legend / stats =====================
document.getElementById("stat-nodes").textContent = NODE.length;
document.getElementById("stat-edges").textContent = EDGE.length;
document.getElementById("stat-pois").textContent = POI.length;

const legendEl = document.getElementById("legend");
for (const [key, spec] of Object.entries(EDGE_STYLE)) {
  const n = EDGE.filter(f => (f.get("edge_type") || "walk") === key).length;
  const row = document.createElement("div");
  row.className = "lg-row";
  row.innerHTML =
    '<span class="lg-swatch" style="background:' + spec.color + (spec.dash ? ";background-image:repeating-linear-gradient(90deg," + spec.color + " 0 6px, transparent 6px 11px)" : "") + '"></span>' +
    '<span class="lg-name">' + spec.label + "</span>" +
    '<span class="lg-count">' + n + "</span>";
  legendEl.appendChild(row);
}
const nodeRow = document.createElement("div");
nodeRow.className = "lg-row";
nodeRow.innerHTML = '<span class="lg-swatch lg-dot" style="background:#334155"></span><span class="lg-name">导航节点</span><span class="lg-count">' + NODE.length + "</span>";
legendEl.appendChild(nodeRow);
const poiRow = document.createElement("div");
poiRow.className = "lg-row";
poiRow.innerHTML = '<span class="lg-swatch lg-dot" style="background:#e11d48"></span><span class="lg-name">兴趣点 POI</span><span class="lg-count">' + POI.length + "</span>";
legendEl.appendChild(poiRow);
"""

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LubanNav 全局导航网络图 — global_nav_0408_wgs84</title>
<style>
  :root {
    --ink: #1f2937; --muted: #6b7280; --line: #e5e7eb;
    --accent: #2563eb; --panel: rgba(255,255,255,.94);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    color: var(--ink); display: flex; flex-direction: column; overflow: hidden;
    background: #eef1f5;
  }
  #header {
    height: 54px; flex: 0 0 auto; display: flex; align-items: center; gap: 14px;
    padding: 0 18px; background: linear-gradient(90deg, #0f172a, #1e3a8a);
    color: #fff; box-shadow: 0 2px 10px rgba(15,23,42,.35); z-index: 10;
  }
  #header .logo { font-size: 20px; font-weight: 800; letter-spacing: .5px; white-space: nowrap; }
  #header .logo small { font-weight: 400; color: #93c5fd; margin-left: 8px; font-size: 12px; }
  #header .spacer { flex: 1; }
  #header .stats { display: flex; gap: 18px; font-size: 12.5px; color: #cbd5e1; white-space: nowrap; }
  #header .stats b { color: #fff; font-size: 14px; margin-right: 3px; }
  #main { flex: 1 1 auto; position: relative; min-height: 0; }
  #map { position: absolute; inset: 0; background: #f8fafc; }
  .ol-attribution { font-size: 10px !important; }
  #panel {
    position: absolute; top: 12px; right: 12px; width: 264px; z-index: 20;
    background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
    box-shadow: 0 8px 24px rgba(15,23,42,.12); backdrop-filter: blur(8px);
    max-height: calc(100% - 24px); overflow: auto; font-size: 13px;
  }
  #panel h2 {
    margin: 0; padding: 12px 14px 10px; font-size: 13.5px; font-weight: 700;
    border-bottom: 1px solid var(--line); display: flex; align-items: center; gap: 6px;
  }
  .sec { padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .sec:last-child { border-bottom: none; }
  .sec-title { font-size: 11.5px; font-weight: 700; color: var(--muted); letter-spacing: .08em; margin: 2px 0 8px; text-transform: uppercase; }
  .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; user-select: none; }
  .row:hover { color: var(--accent); }
  .row input { accent-color: var(--accent); }
  .legend { display: flex; flex-direction: column; gap: 4px; }
  .lg-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  .lg-swatch { width: 16px; height: 5px; border-radius: 3px; flex: 0 0 auto; background: #ccc; }
  .lg-dot { height: 11px; width: 11px; border-radius: 50%; }
  .lg-name { flex: 1; }
  .lg-count { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
  .btns { display: flex; gap: 8px; }
  .btn {
    flex: 1; border: 1px solid var(--line); background: #fff; border-radius: 8px;
    padding: 6px 8px; font-size: 12.5px; cursor: pointer; color: var(--ink);
  }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  .note { font-size: 11px; color: var(--muted); margin-top: 6px; line-height: 1.5; }
  #tooltip {
    position: absolute; display: none; pointer-events: none; z-index: 1000;
    background: rgba(15,23,42,.92); color: #fff; font-size: 12px; line-height: 1.5;
    padding: 7px 10px; border-radius: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.25);
    max-width: 320px; white-space: nowrap;
  }
  #infobox {
    position: absolute; left: 12px; bottom: 44px; z-index: 30; display: none;
    width: 300px; background: var(--panel); border: 1px solid var(--line);
    border-radius: 12px; box-shadow: 0 8px 24px rgba(15,23,42,.14);
    font-size: 12.5px; overflow: hidden;
  }
  #infobox .ib-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px; background: #f8fafc; border-bottom: 1px solid var(--line);
    font-weight: 700; font-size: 12.5px;
  }
  #infobox .ib-close { cursor: pointer; color: var(--muted); font-size: 14px; padding: 0 4px; }
  #infobox .ib-close:hover { color: var(--ink); }
  #infobox .ib-body { padding: 10px 12px; max-height: 260px; overflow: auto; }
  #infobox table { border-collapse: collapse; width: 100%; }
  #infobox td { padding: 3px 6px; vertical-align: top; word-break: break-all; }
  #infobox td.k { color: var(--muted); width: 76px; white-space: nowrap; }
  #statusbar {
    height: 28px; flex: 0 0 auto; display: flex; align-items: center;
    padding: 0 14px; background: #0f172a; color: #cbd5e1; font-size: 11.5px; gap: 18px;
    font-variant-numeric: tabular-nums;
  }
  #statusbar .spacer { flex: 1; }
</style>
</head>
<body>
  <div id="header">
    <div class="logo">🧭 LubanNav 全局导航网络图<small>global_nav_0408_wgs84 · 校园户外导航图</small></div>
    <div class="spacer"></div>
    <div class="stats">
      <span><b id="stat-nodes">–</b>节点</span>
      <span><b id="stat-edges">–</b>边</span>
      <span><b id="stat-pois">–</b>POI</span>
    </div>
  </div>
  <div id="main">
    <div id="map"></div>
    <div id="panel">
      <h2>图层</h2>
      <div class="sec">
        <label class="row"><input type="checkbox" id="chk-edge" checked> 导航边（道路 / 电梯 / 楼梯 / 门）</label>
        <label class="row"><input type="checkbox" id="chk-node" checked> 导航节点</label>
        <label class="row"><input type="checkbox" id="chk-poi" checked> 兴趣点 POI</label>
        <label class="row"><input type="checkbox" id="chk-label" checked> POI 名称标注</label>
      </div>
      <div class="sec">
        <div class="sec-title">底图（离线默认无底图）</div>
        <label class="row"><input type="radio" name="basemap" value="none" checked> 无底图（纯本地）</label>
        <label class="row"><input type="radio" name="basemap" value="osm"> OpenStreetMap</label>
        <label class="row"><input type="radio" name="basemap" value="light"> Carto 浅色</label>
        <label class="row"><input type="radio" name="basemap" value="dark"> Carto 深色</label>
        <div class="note">底图瓦片需要联网加载；离线时请保持「无底图」。</div>
      </div>
      <div class="sec">
        <div class="sec-title">图例</div>
        <div class="legend" id="legend"></div>
      </div>
      <div class="sec">
        <div class="btns">
          <button class="btn" id="btn-fit">🔍 全图</button>
          <button class="btn" id="btn-info-clear">✕ 关闭信息</button>
        </div>
        <div class="note">悬停高亮查看要素；单击要素查看属性与 WGS84 坐标。</div>
      </div>
    </div>
    <div id="tooltip"></div>
    <div id="infobox">
      <div class="ib-head"><span>要素属性</span><span class="ib-close" id="ib-close">✕</span></div>
      <div class="ib-body"></div>
    </div>
  </div>
  <div id="statusbar">
    <span>数据：LubanNav/artifacts/global_nav_0408_wgs84.geojson</span>
    <span>投影：Web Mercator（显示为 WGS84）</span>
    <span class="spacer"></span>
    <span id="status-coord">–, –</span>
  </div>
<script>__OL_JS__</script>
<script>__APP_JS__</script>
</body>
</html>
"""


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    data_path = pathlib.Path(sys.argv[1])
    out_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else data_path.with_suffix(".map.html")
    ol_path = pathlib.Path(sys.argv[3]) if len(sys.argv) > 3 else REPO / "node_modules/ol/dist/ol.js"

    data = json.loads(data_path.read_text(encoding="utf-8"))
    ol_js = ol_path.read_text(encoding="utf-8").replace("</", "<\\/")
    app_js = APP_JS.replace("__DATA__", json.dumps(data, ensure_ascii=False))

    html = (
        HTML_TEMPLATE
        .replace("__OL_JS__", ol_js)
        .replace("__APP_JS__", app_js)
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    print(f"written: {out_path} ({out_path.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
