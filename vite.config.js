// Serves the MediaPipe wasm runtime from node_modules, so the camera layer needs no CDN.
//
// The wasm ships inside @mediapipe/tasks-vision but sits outside Vite's public directory, so it is
// neither served in dev nor copied on build by default. The model itself is committed under
// models/ (see models/README.md) and Vite serves that as an ordinary project file.
import { createReadStream } from "node:fs"
import { cp, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join, normalize } from "node:path"

const wasmDir = join(dirname(fileURLToPath(import.meta.resolve("@mediapipe/tasks-vision"))), "wasm")

const TYPES = { ".wasm": "application/wasm", ".js": "text/javascript", ".mjs": "text/javascript" }

function mediapipeWasm() {
  return {
    name: "mediapipe-wasm",
    configureServer(server) {
      server.middlewares.use("/mediapipe", async (req, res, next) => {
        // Strip the query Vite appends to module requests, and refuse anything that climbs out.
        const name = normalize(decodeURIComponent((req.url || "").split("?")[0])).replace(/^(\.\.[/\\])+/, "")
        const file = join(wasmDir, name)
        if (!file.startsWith(wasmDir)) return next()
        try {
          if (!(await stat(file)).isFile()) return next()
        } catch {
          return next()
        }
        const extension = file.slice(file.lastIndexOf("."))
        res.setHeader("Content-Type", TYPES[extension] || "application/octet-stream")
        createReadStream(file).pipe(res)
      })
    },
    async closeBundle() {
      await cp(wasmDir, "dist/mediapipe", { recursive: true })
    },
  }
}

export default {
  plugins: [mediapipeWasm()],
  // The model is 7.5MB; inlining it or warning about its size adds nothing.
  build: { assetsInlineLimit: 0, chunkSizeWarningLimit: 4096 },
}
