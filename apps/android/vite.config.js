import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import packageJson from '../../package.json'

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared-assets': resolve(__dirname, '../../src/assets'),
    },
  },
  build: {
    target: 'es2018',
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true },
      format: { comments: false },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    fs: { allow: [resolve(__dirname, '../..')] },
    proxy: {
      // 必须排在 /api 之前：vite 按对象键顺序做前缀匹配
      '/api/qq': {
        target: 'http://127.0.0.1:36532',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/qq/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:36531',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: { port: 4174, strictPort: true },
})
