import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    target: 'es2018',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.warn']
      },
      mangle: {
        eval: false
      },
      format: {
        comments: false
      }
    },
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      'axios',
      'howler'
    ],
    exclude: []
  },
  css: {
    modules: false,
    postcss: {},
    preprocessorOptions: {
      scss: {
        quietDeps: true
      }
    }
  },
  server: {
    open: false,
    cors: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:36530',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/siren-api': {
        target: 'https://monster-siren.hypergryph.com/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/siren-api/, '')
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: true
  }
})
