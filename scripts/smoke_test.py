#!/usr/bin/env python3
"""SpatialHarness 冒烟测试：完整用户旅程验证。
用法：先启动 dev server（pnpm dev），再执行
  /tmp/pw-venv/bin/python scripts/smoke_test.py
依赖：python3 venv 内安装 playwright（channel=chrome 使用系统 Chrome）。
"""
import json
import struct
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:5173'
FIXTURE = '/tmp/smoke_cities.geojson'

fixture = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "properties": {"name": "北京", "pop": 2189, "kind": "capital"}, "geometry": {"type": "Point", "coordinates": [116.4074, 39.9042]}},
        {"type": "Feature", "properties": {"name": "上海", "pop": 2487, "kind": "city"}, "geometry": {"type": "Point", "coordinates": [121.4737, 31.2304]}},
        {"type": "Feature", "properties": {"name": "广州", "pop": 1868, "kind": "city"}, "geometry": {"type": "Point", "coordinates": [113.2644, 23.1291]}},
        {"type": "Feature", "properties": {"name": "京津冀区域", "pop": 11000, "kind": "region"}, "geometry": {"type": "Polygon", "coordinates": [[[115.0, 38.5], [118.5, 38.5], [118.5, 41.0], [115.0, 41.0], [115.0, 38.5]]]}},
    ],
}
with open(FIXTURE, 'w') as f:
    json.dump(fixture, f)

# 生成最小 GeoTIFF fixture（8×8 灰度 + EPSG:4326，与 src/core/datasource/geotiffFixture.ts 一致）
TIFF_FIXTURE = '/tmp/smoke_fixture.tif'
def build_tiff(path, w=8, h=8, scale=0.1, lon=116.0, lat=40.0):
    pixel = w * h
    entry_count = 12
    ifd_offset = 8
    ifd_size = 2 + entry_count * 12 + 4
    off = ifd_offset + ifd_size
    align = lambda n: off if off % n == 0 else off + (n - off % n)
    scale_off = align(8); off = scale_off + 24
    tie_off = align(8); off = tie_off + 48
    keys_off = align(2); keys_len = 4 + 3 * 4; off = keys_off + keys_len * 2
    data_off = align(1); off = data_off + pixel
    buf = bytearray(off)
    buf[0:2] = b'II'
    struct.pack_into('<H', buf, 2, 0x2a)
    struct.pack_into('<I', buf, 4, ifd_offset)
    struct.pack_into('<H', buf, ifd_offset, entry_count)
    e = ifd_offset + 2
    def entry(tag, typ, cnt, val):
        nonlocal e
        struct.pack_into('<HHI', buf, e, tag, typ, cnt); struct.pack_into('<I', buf, e + 8, val); e += 12
    entry(256, 4, 1, w); entry(257, 4, 1, h); entry(258, 3, 1, 8)
    entry(259, 3, 1, 1); entry(262, 3, 1, 1); entry(273, 4, 1, data_off)
    entry(277, 3, 1, 1); entry(278, 4, 1, h); entry(279, 4, 1, pixel)
    entry(33550, 12, 3, scale_off); entry(33922, 12, 6, tie_off); entry(34735, 3, keys_len, keys_off)
    struct.pack_into('<I', buf, e, 0)
    struct.pack_into('<ddd', buf, scale_off, scale, scale, 0.0)
    struct.pack_into('<dddddd', buf, tie_off, 0, 0, 0, lon, lat, 0)
    k = keys_off
    for v in (1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326):
        struct.pack_into('<H', buf, k, v); k += 2
    for i in range(pixel):
        buf[data_off + i] = i % 256
    with open(path, 'wb') as f:
        f.write(buf)
build_tiff(TIFF_FIXTURE)

results = []
def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(f"{'✓' if cond else '✗'} {name} {extra}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='chrome', args=['--no-proxy-server'])
    page = browser.new_page(viewport={'width': 1600, 'height': 950})
    console_errors = []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: console_errors.append(str(e)))

    def lonlat_to_pixel(lon, lat):
        return page.evaluate("""async ([lon, lat]) => {
          const geo = await import('/src/core/geo/transform.ts');
          const store = await import('/src/state/project.ts');
          const view = store.useProjectStore.getState().view;
          if (!view) return null;
          const [mx, my] = geo.toWebMercator([lon, lat]);
          const res = 156543.03392804097 / Math.pow(2, view.zoom);
          const el = document.querySelector('.ol-viewport');
          const rect = el.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2 + (mx - view.center[0]) / res,
            y: rect.top + rect.height / 2 - (my - view.center[1]) / res,
          };
        }""", [lon, lat])

    # 1. 启动
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)
    check('欢迎页显示', page.get_by_text('SpatialHarness').count() > 0)

    # 2. 新建工程
    page.get_by_role('button', name='新建工程').first.click()
    page.wait_for_timeout(300)
    page.get_by_role('button', name='创建').click()
    page.wait_for_timeout(500)
    check('工程已创建（欢迎页消失）', page.get_by_text('SpatialHarness').count() == 0)

    # 3. 导入 GeoJSON
    page.set_input_files('input[type=file][accept*="geojson"]', FIXTURE)
    page.wait_for_timeout(2500)
    check('图层出现在图层面板', page.get_by_text('smoke_cities').count() > 0)

    # 4. 自动保存
    page.wait_for_timeout(2500)
    check('自动保存成功（仅浏览器内）', page.get_by_text('已保存（仅浏览器内）').count() > 0)

    # 5. 选择图层 → 属性表
    page.locator('text=smoke_cities').first.click()
    page.wait_for_timeout(800)
    check('属性表显示 4 行', '共 4 行' in page.content())

    # 6. 识别工具：点击北京要素
    page.get_by_title('识别').click()
    page.wait_for_timeout(400)
    pt = lonlat_to_pixel(116.4074, 39.9042)
    assert pt, '无法计算要素像素位置'
    page.mouse.click(pt['x'], pt['y'])
    page.wait_for_timeout(1000)
    check('识别选中 1 个要素', '选中 1' in page.content())

    # 7. 样式面板
    page.get_by_role('button', name='样式', exact=True).click()
    page.wait_for_timeout(500)
    check('样式面板打开', page.get_by_text('符号类型').count() > 0 or page.get_by_text('单一符号').count() > 0)

    # 7.5 导出 Shapefile（zip 打包 shp/shx/dbf/prj/cpg）
    with page.expect_download() as dl_info:
        page.get_by_title('导出图层').click()
        page.wait_for_timeout(300)
        page.get_by_role('button', name='Shapefile (.zip)').click()
    download = dl_info.value
    export_path = '/tmp/smoke_export.zip'
    download.save_as(export_path)
    with open(export_path, 'rb') as f:
        magic = f.read(2)
    check('Shapefile 导出下载为 zip（PK 魔数）', download.suggested_filename.endswith('.zip') and magic == b'PK')
    page.wait_for_timeout(600)  # 等待 React 提交状态栏 flash
    check('导出成功提示', page.get_by_text('已导出').count() > 0)

    # 7.6 导出 GPX（wpt/trk 文本）
    with page.expect_download() as dl_info:
        page.get_by_title('导出图层').click()
        page.wait_for_timeout(300)
        page.get_by_role('button', name='GPX (.gpx)').click()
    gpx_download = dl_info.value
    gpx_path = '/tmp/smoke_export.gpx'
    gpx_download.save_as(gpx_path)
    with open(gpx_path, encoding='utf-8') as f:
        gpx_head = f.read(200)
    check('GPX 导出下载（gpx 头）', gpx_download.suggested_filename.endswith('.gpx') and '<gpx version="1.1"' in gpx_head)

    # 7.7 导出 GeoPackage（SQLite WASM；首次调用触发 wasm 加载，可能稍慢）
    with page.expect_download(timeout=60000) as dl_info:
        page.get_by_title('导出图层').click()
        page.wait_for_timeout(300)
        page.get_by_role('button', name='GeoPackage (.gpkg)').click()
    gpkg_download = dl_info.value
    gpkg_path = '/tmp/smoke_export.gpkg'
    gpkg_download.save_as(gpkg_path)
    with open(gpkg_path, 'rb') as f:
        gpkg_magic = f.read(2)
    check('GeoPackage 导出下载（SQLite 魔数）', gpkg_download.suggested_filename.endswith('.gpkg') and gpkg_magic == b'SQ')

    # 8. 分析：缓冲区（算子下拉按选项内容定位，避免依赖 select 序号）
    page.get_by_role('button', name='分析', exact=True).click()
    page.wait_for_timeout(400)
    op_select = page.locator('select').filter(has=page.locator('option', has_text='缓冲区'))
    op_select.select_option(label='缓冲区')
    page.wait_for_timeout(400)
    page.get_by_role('button', name='开始分析').click()
    page.wait_for_timeout(3500)
    check('缓冲区结果图层出现', page.get_by_text('缓冲区_', exact=False).count() > 0)
    check('分析完成提示', page.get_by_text('分析完成').count() > 0)

    # 9. 绘制点
    page.get_by_title('绘制点').click()
    page.wait_for_timeout(400)
    pt2 = lonlat_to_pixel(119.5, 35.5)
    page.mouse.click(pt2['x'], pt2['y'])
    page.wait_for_timeout(900)
    page.locator('text=smoke_cities').first.click()
    page.wait_for_timeout(600)
    check('绘制后 5 行', '共 5 行' in page.content())

    # 10. 撤销 / 重做
    page.get_by_title('撤销 (⌘Z)').click()
    page.wait_for_timeout(900)
    check('撤销后 4 行', '共 4 行' in page.content())
    page.get_by_title('重做 (⌘⇧Z)').click()
    page.wait_for_timeout(900)
    check('重做后 5 行', '共 5 行' in page.content())

    # 11. 刷新恢复
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3000)
    check('刷新后工程恢复', page.get_by_text('smoke_cities').count() > 0)
    page.locator('text=smoke_cities').first.click()
    page.wait_for_timeout(800)
    check('刷新后恢复 5 行', '共 5 行' in page.content())
    page.wait_for_timeout(2500)
    check('刷新后自动保存状态', page.get_by_text('已保存（仅浏览器内）').count() > 0)

    # 11.5 GeoPackage 导入回环：把导出的 .gpkg 重新导入（worker WASM 解析路径）
    # 导入图层名取文件主干名 smoke_export
    page.set_input_files('input[type=file][accept*="geojson"]', gpkg_path)
    page.wait_for_timeout(5000)
    check('GeoPackage 导入回环（新图层出现）', page.get_by_text('smoke_export').count() > 0)

    # 11.8 GDAL 栅格处理：导入 GeoTIFF → PNG 导出 / GeoPackage 瓦片导出
    page.set_input_files('input[type=file][accept*="geojson"]', TIFF_FIXTURE)
    page.wait_for_timeout(2500)
    check('GeoTIFF 导入为栅格图层', page.get_by_text('smoke_fixture').count() > 0)
    page.locator('text=smoke_fixture').first.click()
    page.wait_for_timeout(600)
    with page.expect_download(timeout=120000) as dl_info:  # 首次触发 GDAL wasm 加载
        page.get_by_title('导出图层').click()
        page.wait_for_timeout(300)
        page.get_by_role('button', name='导出 PNG（GDAL 转换）').click()
    png_dl = dl_info.value
    png_path = '/tmp/smoke_raster.png'
    png_dl.save_as(png_path)
    with open(png_path, 'rb') as f:
        png_magic = f.read(4)
    check('GDAL 导出 PNG（PNG 魔数）', png_dl.suggested_filename.endswith('.png') and png_magic[:3] == b'\x89PN')
    with page.expect_download(timeout=120000) as dl_info:
        page.get_by_title('导出图层').click()
        page.wait_for_timeout(300)
        page.get_by_role('button', name='导出 GeoPackage 瓦片 (.gpkg)').click()
    tiles_dl = dl_info.value
    tiles_path = '/tmp/smoke_tiles.gpkg'
    tiles_dl.save_as(tiles_path)
    with open(tiles_path, 'rb') as f:
        tiles_magic = f.read(2)
    check('GeoPackage 瓦片导出（SQLite 魔数）', tiles_dl.suggested_filename.endswith('.gpkg') and tiles_magic == b'SQ')

    # 12. 控制台错误（过滤已知三方库内部噪音：ol DataTile 数组渲染限制、
    #     gdal3.js 内联模式的内部 promise 引用——均不影响功能）
    benign = ['favicon', 'Rendering array data is not yet supported', "Cannot read properties of undefined (reading 'then')"]
    severe = [e for e in console_errors if not any(b in e for b in benign)]
    check('无严重控制台错误', len(severe) == 0, f'errors={severe[:4]}')

    page.screenshot(path='/tmp/smoke_final.png')
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n=== {len(results) - len(failed)}/{len(results)} 通过 ===")
sys.exit(1 if failed else 0)
