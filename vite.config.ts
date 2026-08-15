/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // shpjs 顶层 require('buffer')：浏览器/Worker 中 polyfill
      buffer: 'buffer/',
    },
  },
  define: {
    // buffer polyfill 依赖的全局对象
    global: 'globalThis',
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
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
