import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const DIRECTORY = fileURLToPath(new URL("../../output/ringsymphony-captures/", import.meta.url))
const ENDPOINT = "/api/capture"
const MAX_BYTES = 48 * 1024 * 1024
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"])
const GROUP_FILE = /^ring-([a-z][a-z0-9-]*?)-complete-(?:(left|right)-)?\d{4}-/

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
  res.end(JSON.stringify(payload))
}

async function readRecording(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length
    if (bytes > MAX_BYTES) {
      req.resume()
      return null
    }
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks)) } catch { return null }
}

function valid(record) {
  if (!record || record.version !== 1 || !UUID.test(record.id) || typeof record.startedAt !== "string" ||
    !Number.isFinite(Date.parse(record.startedAt)) || !Number.isFinite(record.durationMs) ||
    typeof record.finishReason !== "string" || !Array.isArray(record.frames)) return false
  const hands = Object.values(record.hands ?? {})
  if (record.playerId !== undefined && (typeof record.playerId !== "string" ||
      !record.playerId.trim() || record.playerId.length > 64)) return false
  if (record.wearNote !== undefined && (typeof record.wearNote !== "string" || record.wearNote.length > 240)) return false
  if (record.dominantHand != null && !["left", "right", "both"].includes(record.dominantHand)) return false
  if (hands.length < 1 || hands.length > 2 || new Set(hands).size !== hands.length ||
    hands.some(hand => hand !== "left" && hand !== "right")) return false
  if (record.kind === "game") return Boolean(record.game && typeof record.game.level?.title === "string")
  if (record.bpm !== undefined && (![80, 100, 120].includes(record.bpm) || !Array.isArray(record.trials) ||
      record.trials.some((trial, i, trials) => !Number.isFinite(trial.beatAtMs) || !Number.isFinite(trial.cueAtMs) ||
        trial.cueAtMs >= trial.beatAtMs || (i > 0 && trial.beatAtMs <= trials[i - 1].beatAtMs) ||
        !["up", "down", "left", "right"].includes(trial.direction)))) return false
  return record.kind === "group" && /^[a-z][a-z0-9-]{0,31}$/.test(record.exercise) && Array.isArray(record.trials) &&
    (record.performingHand === "both" || hands.includes(record.performingHand))
}

function json(value) { return JSON.stringify(value, null, 2) + "\n" }

async function save(directory, record) {
  const timestamp = new Date(record.startedAt).toISOString().replace(/[:.]/g, "-")
  const suffix = `${timestamp}-${record.id}`
  const folder = record.kind === "group" ? "groups" : "games"
  const hands = Object.values(record.hands)
  const handTag = hands.length === 1 ? `${hands[0]}-` : ""
  const groupStatus = record.finishReason !== "complete" ? "partial" : record.quality?.recommendRetry ? "check" : "complete"
  const name = record.kind === "group"
    ? `ring-${record.exercise}-${groupStatus}-${handTag}${suffix}.json`
    : suffix
  const location = `${folder}/${name}`
  const parent = join(directory, folder)
  const target = join(parent, name)
  await mkdir(parent, { recursive: true })
  if (!(await stat(target).catch((error) => {
    if (error.code !== "ENOENT") throw error
  }))) {
    const temporary = await mkdtemp(join(parent, ".saving-"))
    try {
      let staged = temporary
      if (folder === "groups") {
        staged = join(temporary, name)
        await writeFile(staged, json(record))
      } else {
        const { frames, ...session } = record
        await writeFile(join(temporary, "game.json"), json({ ...session, frameCount: frames.length }))
        const header = { type: "session", version: session.version, id: session.id, startedAt: session.startedAt, hands: session.hands }
        const end = { type: "end", frames: frames.length, finishReason: session.finishReason, gaps: session.gaps }
        await writeFile(join(temporary, "imu.jsonl"), [header, ...frames, end].map((frame) => JSON.stringify(frame) + "\n").join(""))
      }
      try { await rename(staged, target) } catch (error) {
        // A previous request for this same session may have published it first.
        if (!(await stat(target).catch(() => false))) throw error
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }
  return location
}

export function captureStorage(directory = DIRECTORY) {
  function configure(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url !== ENDPOINT) return next()
      const host = req.headers.host
      if (!LOOPBACK.has(req.socket.remoteAddress) || !LOCAL_HOST.test(host ?? "")) return send(res, 403, { error: "采集仅接受本机页面" })
      try {
        if (req.method === "GET") {
          await Promise.all(["groups", "games"].map((folder) => mkdir(join(directory, folder), { recursive: true })))
          const groups = await readdir(join(directory, "groups"))
          const completed = { both: new Set(), left: new Set(), right: new Set() }
          for (const name of groups) {
            const match = GROUP_FILE.exec(name)
            if (match) completed[match[2] ?? "both"].add(match[1])
          }
          const completedByMode = Object.fromEntries(Object.entries(completed).map(([mode, ids]) => [mode, [...ids]]))
          return send(res, 200, { directory, completed: completedByMode.both, completedByMode })
        }
        if (req.method !== "POST") return send(res, 405, { error: "无法处理此请求" })
        if (req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) return send(res, 403, { error: "请从本机采集页保存" })
        if (req.headers["content-type"] !== "application/json") return send(res, 415, { error: "记录格式无效" })
        const record = await readRecording(req)
        if (!valid(record)) return send(res, 400, { error: "记录无效或超出单次保存大小" })
        return send(res, 201, { saved: await save(directory, record) })
      } catch (error) {
        server.config.logger.error(`保存采集记录失败 ${error.message}`)
        return send(res, 500, { error: "写入本机目录失败" })
      }
    })
  }
  return { name: "capture-storage", configureServer: configure, configurePreviewServer: configure }
}
