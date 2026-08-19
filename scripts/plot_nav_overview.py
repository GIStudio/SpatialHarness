#!/usr/bin/env python3
"""Static overview plot of a navigation-graph GeoJSON (matplotlib, CJK labels).

Usage:
    python3 scripts/plot_nav_overview.py <input.geojson> [output.png]
"""

import json
import pathlib
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.patches import Circle

EDGE_SPEC = {
    "walk":              ("#2563eb", "步行道"),
    "stairs":            ("#f97316", "楼梯"),
    "elevator_vertical": ("#dc2626", "垂直电梯"),
    "elevator_slanted":  ("#a855f7", "斜梯"),
    "gate":              ("#059669", "门 / 闸口"),
}
NODE_COLOR = "#334155"
POI_COLOR = "#e11d48"


def pick_cjk_font():
    for name in ("Noto Sans CJK SC", "PingFang SC", "Heiti TC", "Arial Unicode MS", "SimHei"):
        if any(f.name == name for f in font_manager.fontManager.ttflist):
            return font_manager.FontProperties(family=name)
    return None


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    data_path = pathlib.Path(sys.argv[1])
    out_path = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else data_path.with_suffix(".overview.png")

    data = json.loads(data_path.read_text(encoding="utf-8"))
    edges, nodes, pois = [], [], []
    for ft in data["features"]:
        p, g = ft.get("properties") or {}, ft.get("geometry") or {}
        t = p.get("type")
        if t == "edge" and g.get("type") == "LineString":
            edges.append((p, g["coordinates"]))
        elif t == "node" and g.get("type") == "Point":
            nodes.append((p, g["coordinates"]))
        elif t == "poi" and g.get("type") == "Point":
            pois.append((p, g["coordinates"]))

    xs = [c[0] for _, c in nodes] + [c[0] for _, c in pois]
    ys = [c[1] for _, c in nodes] + [c[1] for _, c in pois]
    for _, coords in edges:
        xs.extend(c[0] for c in coords)
        ys.extend(c[1] for c in coords)
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    mx = (x1 - x0) * 0.04
    x0, x1, y0, y1 = x0 - mx, x1 + mx, y0 - mx, y1 + mx

    fp = pick_cjk_font()
    plt.rcParams["font.family"] = fp.get_name() if fp else "sans-serif"

    fig, ax = plt.subplots(figsize=(16, 11), dpi=150)
    fig.patch.set_facecolor("white")
    ax.set_facecolor("#fafbfc")

    for p, coords in edges:
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        spec = EDGE_SPEC.get(p.get("edge_type"), EDGE_SPEC["walk"])
        ax.plot(lons, lats, color=spec[0], lw=1.1, solid_capstyle="round", zorder=2)

    ax.scatter([c[0] for _, c in nodes], [c[1] for _, c in nodes],
               s=6, color=NODE_COLOR, zorder=3, linewidths=0)

    ax.scatter([c[0] for _, c in pois], [c[1] for _, c in pois],
               s=90, color=POI_COLOR, zorder=4, edgecolors="white", linewidths=1.5)
    # spread labels around their markers to reduce overlap in dense clusters
    offsets = [(0, 11), (16, 11), (-16, 11), (0, -12), (16, -12), (-16, -12)]
    for i, (p, (lon, lat)) in enumerate(pois):
        dx, dy = offsets[i % len(offsets)]
        ax.annotate(p.get("name", ""), (lon, lat), xytext=(dx, dy), textcoords="offset points",
                    ha="center", va="center", fontsize=9, zorder=5,
                    bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="#cbd5e1", lw=0.6, alpha=0.92))

    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    # correct lon/lat aspect at mid latitude (1° lon = cos(lat) × 1° lat)
    mid_lat = (y0 + y1) / 2
    import math
    ax.set_aspect(1.0 / math.cos(math.radians(mid_lat)))

    ax.tick_params(labelsize=8, colors="#64748b")
    ax.set_xlabel("经度 (WGS84)", fontsize=10)
    ax.set_ylabel("纬度 (WGS84)", fontsize=10)
    ax.grid(True, color="#e2e8f0", lw=0.5, zorder=1)
    ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.3f}"))
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{v:.3f}"))

    handles = [
        Line2D([0], [0], color=color, lw=2.4, label=f"{label}（{n}）")
        for key, (color, label) in EDGE_SPEC.items()
        for n in [sum(1 for p, _ in edges if (p.get("edge_type") or "walk") == key)]
    ]
    handles += [
        Line2D([0], [0], marker="o", color="w", markerfacecolor=NODE_COLOR, markersize=6, label=f"导航节点（{len(nodes)}）"),
        Line2D([0], [0], marker="o", color="w", markerfacecolor=POI_COLOR, markersize=9, markeredgecolor="white", label=f"兴趣点 POI（{len(pois)}）"),
    ]
    ax.legend(handles=handles, loc="lower left", frameon=True, fontsize=9,
              framealpha=0.95, edgecolor="#e5e7eb", ncol=2)

    ax.set_title("LubanNav 全局导航网络图 — global_nav_0408_wgs84"
                 f"（节点 {len(nodes)} · 边 {len(edges)} · POI {len(pois)}）",
                 fontsize=15, pad=14, fontweight="bold")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, bbox_inches="tight", facecolor="white")
    print(f"written: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
