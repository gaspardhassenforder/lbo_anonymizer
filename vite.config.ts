import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read version from package.json
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))
const APP_VERSION = packageJson.version

const corsHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      // Force ESM versions of onnxruntime-web for browser
      'onnxruntime-web/webgpu': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs'),
      'onnxruntime-web/webgl': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.webgl.min.mjs'),
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web/dist/ort.bundle.min.mjs'),
    }
  },
  optimizeDeps: {
    exclude: [
      '@huggingface/transformers',
      'onnxruntime-web',
      'gliner',
    ]
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-worker': ['pdfjs-dist'],
        }
      }
    }
  },
  server: {
    headers: corsHeaders,
    allowedHosts: ['localhost', 'host.docker.internal'],
  },
  preview: {
    headers: corsHeaders
  }
})
