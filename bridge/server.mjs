// Bridge: Ring Studio local TCP (JSON lines, 127.0.0.1:17888) → WebSocket for the browser game.
// Usage: node bridge/server.mjs [--studio 127.0.0.1:17888] [--port 8787]
import net from "node:net"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"

const MAX_BUFFERED = 1 << 20

export function startBridge({ studioHost = "127.0.0.1", studioPort = 17888, port = 8787, log = console.log } = {}) {
  const wss = new WebSocketServer({
    host: "127.0.0.1",
    port,
    // Only pages served from this machine may read the IMU stream.
    verifyClient: ({ origin }) => !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin),
  })
  let socket = null
  let connected = false
  let pending = []
  let flushTimer = null
  let retry = null
  let stopped = false

  const state = () => JSON.stringify({ type: "bridge", tcp: connected })

  function broadcast(text) {
    for (const client of wss.clients) {
      if (client.readyState === 1 && client.bufferedAmount < MAX_BUFFERED) client.send(text)
    }
  }

  function flush() {
    flushTimer = null
    if (!pending.length) return
    const text = pending.join("\n")
    pending = []
    broadcast(text)
  }

  function setConnected(value) {
    if (connected === value) return
    connected = value
    log(value ? "Ring Studio 已连接" : "Ring Studio 已断开")
    broadcast(state())
  }

  function connect() {
    if (stopped) return
    let buffer = ""
    socket = net.createConnection({ host: studioHost, port: studioPort })
    socket.setEncoding("utf8")
    socket.setNoDelay(true)
    socket.on("connect", () => {
      setConnected(true)
      socket.write('{"cmd":"subscribe","rings":[],"streams":["imu"]}\n')
    })
    socket.on("data", (chunk) => {
      buffer += chunk
      let index
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line) pending.push(line)
      }
      if (!flushTimer) flushTimer = setTimeout(flush, 8)
    })
    const lost = () => {
      socket?.destroy()
      socket = null
      setConnected(false)
      if (!stopped) retry = setTimeout(connect, 1000)
    }
    socket.on("error", () => {})
    socket.on("close", lost)
  }

  wss.on("connection", (client) => {
    client.send(state())
    // Ask Ring Studio to resend the ring list so a late page learns the devices.
    socket?.write('{"cmd":"status"}\n')
  })
  wss.on("listening", () => log(`WebSocket ws://127.0.0.1:${port}  ←  Ring Studio ${studioHost}:${studioPort}`))
  connect()

  return {
    wss,
    close() {
      stopped = true
      clearTimeout(retry)
      clearTimeout(flushTimer)
      socket?.destroy()
      wss.close()
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : fallback
  }
  const [studioHost, studioPort] = arg("studio", "127.0.0.1:17888").split(":")
  startBridge({ studioHost, studioPort: Number(studioPort), port: Number(arg("port", 8787)) })
}
