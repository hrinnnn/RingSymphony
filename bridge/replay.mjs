// Stand-in for Ring Studio's TCP API: replays recorded IMU data for two rings in real time, so the game can be
// tried without hardware. Usage: node bridge/replay.mjs [--right 四拍/yyh] [--left 上升/lry] [--port 17888]
import { readFile } from "node:fs/promises"
import net from "node:net"
import { fileURLToPath } from "node:url"

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const port = Number(arg("port", 17888))
const sources = [
  { address: "AA:00:00:00:00:01", name: "Ringo-R(replay)", file: arg("right", "四拍/yyh") },
  { address: "AA:00:00:00:00:02", name: "Ringo-L(replay)", file: arg("left", "上升/lry") },
]

for (const source of sources) {
  const raw = JSON.parse(await readFile(new URL(`../recordings/${source.file}.json`, import.meta.url), "utf8"))
  source.data = raw
  source.length = raw.t[raw.t.length - 1] + 0.005
}

const clients = new Set()
const status = () => JSON.stringify({ type: "status", rings: sources.map(({ address, name }) => ({ address, name, connected: true })) }) + "\n"

const server = net.createServer((socket) => {
  const client = { socket, streams: true }
  clients.add(client)
  socket.write('{"type":"hello","version":1}\n' + status())
  let buffer = ""
  socket.setEncoding("utf8")
  socket.on("data", (chunk) => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i)
      buffer = buffer.slice(i + 1)
      try {
        const command = JSON.parse(line)
        if (command.cmd === "status") socket.write(status())
        if (command.cmd === "subscribe") {
          client.streams = true
          socket.write(JSON.stringify({ type: "subscribed", rings: [], streams: ["imu"] }) + "\n")
        }
      } catch {
        socket.write('{"type":"error","message":"invalid_command"}\n')
      }
    }
  })
  socket.on("close", () => clients.delete(client))
  socket.on("error", () => clients.delete(client))
})

const started = process.hrtime.bigint()
const elapsed = () => Number(process.hrtime.bigint() - started) / 1e9
const cursors = sources.map(() => ({ index: 0, lap: 0, sequence: 0 }))

setInterval(() => {
  const now = elapsed()
  const lines = []
  sources.forEach((source, n) => {
    const cursor = cursors[n]
    const { t, acc, gyr } = source.data
    for (;;) {
      const at = cursor.lap * source.length + t[cursor.index]
      if (at > now) break
      lines.push(JSON.stringify({
        type: "imu", address: source.address, name: source.name, timestamp: at, local_timestamp: at, host_timestamp: 0,
        sequence: cursor.sequence++, acc: acc[cursor.index], gyr: gyr[cursor.index],
      }))
      cursor.index += 1
      if (cursor.index >= t.length) { cursor.index = 0; cursor.lap += 1 }
    }
  })
  if (!lines.length) return
  const text = lines.join("\n") + "\n"
  for (const client of clients) client.socket.write(text)
}, 5)

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  server.listen(port, "127.0.0.1", () => console.log(`模拟 Ring Studio 127.0.0.1:${port}：右 ${sources[0].file}，左 ${sources[1].file}`))
}
