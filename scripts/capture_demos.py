#!/usr/bin/env python3
"""逐场景截图：自动启动 dev server，载入每个 ?demo= 场景并保存效果图到 demo/screenshots/。
用法（仓库根目录）：
  /tmp/pw-venv/bin/python scripts/capture_demos.py
  或任何安装了 playwright 的 python3（channel=chrome 使用系统 Chrome）。
"""
import os
import subprocess
import sys
import time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'demo', 'screenshots')
BASE = 'http://localhost:5173'

SCENARIOS = [
    'world-population',
    'china-regions',
    'world-cities',
    'earthquakes-week',
    'rivers-osm',
    'parcels-landuse',
    'auto-gdp',
]

# 额外验证 PNG 导出链路的场景
EXPORT_SCENARIOS = {'world-population', 'china-regions'}


def wait_server(timeout=30):
    import urllib.request
    # 本机请求绕过代理（环境可能配置了全局 HTTP 代理）
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(timeout * 2):
        try:
            opener.open(BASE, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    os.makedirs(OUT, exist_ok=True)
    server = None
    if not wait_server(timeout=2):
        server = subprocess.Popen(
            ['pnpm', 'dev'],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if not wait_server():
            print('dev server 启动失败', file=sys.stderr)
            server.terminate()
            return 1
    try:
        with sync_playwright() as p:
            # 瓦片走系统代理，本地地址直连
            proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
            launch_kwargs = {'headless': True, 'channel': 'chrome'}
            if proxy:
                launch_kwargs['proxy'] = {'server': proxy, 'bypass': 'localhost,127.0.0.1'}
            else:
                launch_kwargs['args'] = ['--no-proxy-server']
            browser = p.chromium.launch(**launch_kwargs)
            for sid in SCENARIOS:
                # 每个场景独立上下文（隔离 IndexedDB 自动保存，避免工程恢复干扰）
                ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
                page = ctx.new_page()
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(f'{BASE}/?demo={sid}')
                try:
                    page.wait_for_load_state('networkidle', timeout=15000)
                except Exception:
                    pass  # 瓦片持续加载时 networkidle 可能超时，不影响截图
                page.wait_for_timeout(4000)  # 等数据解析/符号化/瓦片
                path = os.path.join(OUT, f'{sid}.png')
                page.screenshot(path=path)
                print(f'✓ {sid} → demo/screenshots/{sid}.png')
                # 对部分场景验证 PNG 导出（图题+图例+版权合成），产出导出成品图
                if sid in EXPORT_SCENARIOS:
                    try:
                        page.get_by_role('button', name='导出 PNG').click()
                        page.wait_for_timeout(400)
                        with page.expect_download(timeout=15000) as dl_info:
                            page.get_by_role('button', name='导出', exact=True).click()
                        dl_info.value.save_as(os.path.join(OUT, f'export-{sid}.png'))
                        print(f'✓ export-{sid}.png（PNG 导出成品）')
                    except Exception as e:
                        print(f'! {sid} PNG 导出失败: {e}')
                if errors:
                    print(f'! {sid} 页面错误（示例）：{errors[:2]}', file=sys.stderr)
                ctx.close()
            browser.close()
        return 0
    finally:
        if server is not None:
            server.terminate()


if __name__ == '__main__':
    sys.exit(main())
