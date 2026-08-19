/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 部署在 <owner>.github.io/<repo>/ 子路径下；
// BASE_PATH 显式指定时优先（本地验证子路径构建用），
// CI（GitHub Actions）自动用仓库名子路径，本地 dev/build 保持根路径。
const base = process.env.BASE_PATH ?? (process.env.GITHUB_ACTIONS === 'true' ? '/SpatialHarness/' : '/')

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  // demo/ 目录作为静态资源根：data/（示例数据）等在 dev 下直接可访问、
  // build 时整体拷贝进 dist（含 favicon.svg）
  publicDir: 'demo',
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      // shpjs 顶层 require('buffer')：浏览器/Worker 中 polyfill
      { find: 'buffer', replacement: 'buffer/' },
      // GeoPackage 依赖 wkx 运行时用 util.inherits：Node 内置 util 被 externalize，
      // 替换为 npm util shim（同 buffer 的处理方式）
      { find: 'util', replacement: 'util/' },
      // GeoPackage：原生 better-sqlite3 不可打包，替身为抛错 stub → 库回退 sql.js WASM
      { find: 'better-sqlite3', replacement: path.resolve(__dirname, 'src/core/datasource/formats/betterSqlite3Stub.ts') },
      // 强制 CJS lib 入口（绕开 browser 字段的 geopackage.min.js 预打包），
      // 保证 Db/SqljsAdapter 与深路径 import 为同一模块实例。精确匹配，
      // 避免误伤 `@ngageoint/geopackage/dist/sql-wasm.wasm?url` 资源导入。
      { find: /^@ngageoint\/geopackage$/, replacement: '@ngageoint/geopackage/dist/index.js' },
    ],
  },
  define: {
    // buffer polyfill 依赖的全局对象
    global: 'globalThis',
  },
  optimizeDeps: {
    // gdal3.js 的 ?url 资产（wasm/data/js）不能被预打包成模块，否则 dev 下地址失效
    exclude: ['gdal3.js'],
  },
  worker: {
    // geotiff 内部动态 import 与默认 iife 冲突：合并为单 chunk
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          // OpenLayers 体积最大且版本稳定，单独分包利于浏览器缓存
          'vendor-ol': ['ol'],
          'vendor-react': ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
