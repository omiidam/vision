import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CONTENT_ROOTS = ['data', 'audio']

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

/**
 * The processed textbook content (`data/`) and the recordings (`audio/`) are committed
 * next to the source code but are *not* part of the JavaScript bundle: they are served
 * and copied verbatim, so the app never inlines lesson content into its code.
 */
function contentAssets(): Plugin {
  return {
    name: 'vision-content-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0])
        const top = url.split('/').filter(Boolean)[0]
        if (!top || !CONTENT_ROOTS.includes(top)) return next()
        const file = path.join(ROOT, url)
        if (!file.startsWith(path.join(ROOT, top)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          return next()
        }
        res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      const outDir = options.dir ?? path.join(ROOT, 'dist')
      for (const root of CONTENT_ROOTS) {
        const source = path.join(ROOT, root)
        if (!fs.existsSync(source)) continue
        fs.cpSync(source, path.join(outDir, root), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [contentAssets()],
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0,
  },
  server: {
    host: true,
    port: 5173,
  },
})
