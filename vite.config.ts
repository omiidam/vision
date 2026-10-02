import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CONTENT_ROOTS = ['data', 'audio']

const MIME: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
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
        const { size } = fs.statSync(file)
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Cache-Control', 'no-cache')

        // A media element needs Content-Length and range support: without them the browser
        // reports duration NaN, never advances currentTime, and seeking silently fails.
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
        if (range) {
          const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1])
          const end = range[2] === '' || range[1] === '' ? size - 1 : Number(range[2])
          if (start >= size || end < start) {
            res.statusCode = 416
            res.setHeader('Content-Range', `bytes */${size}`)
            res.end()
            return
          }
          res.statusCode = 206
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
          res.setHeader('Content-Length', String(end - start + 1))
          fs.createReadStream(file, { start, end }).pipe(res)
          return
        }

        res.setHeader('Content-Length', String(size))
        if (req.method === 'HEAD') {
          res.end()
          return
        }
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
