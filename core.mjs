// Framework-agnostic desk-bridge core: pairing, token storage, event/patch
// fetch, and OSC push. No prompts, no process.exit — functions return values or
// throw Error(message) (with an optional `.code`). Shared by the Electron main
// process (and any future CLI). The browser/renderer never imports this.

import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { buildMessages } from './x32.mjs'
import { buildMessages as buildXAir } from './xair.mjs'
import { buildMessages as buildYamaha } from './yamaha.mjs'
import { buildMessages as buildAh } from './ah.mjs'
import { sendMessages } from './udp.mjs'
import { sendFrames } from './tcp.mjs'

export { buildMessages, sendMessages }

// Console driver registry. OSC drivers (udp) emit [{address,args}]; TCP drivers
// emit raw frames (strings / Buffers). `port` is the per-console default.
const DRIVERS = {
  x32: { transport: 'udp', port: 10023, build: buildMessages },
  xair: { transport: 'udp', port: 10024, build: buildXAir },
  'yamaha-clql': { transport: 'tcp', port: 49280, build: buildYamaha },
  'yamaha-rivage': { transport: 'tcp', port: 49280, build: buildYamaha },
  'ah-sq': { transport: 'tcp', port: 51325, build: (ch) => buildAh(ch, 'sq') },
  'ah-dlive': { transport: 'tcp', port: 51325, build: (ch) => buildAh(ch, 'dlive') },
}

/** The driver for a console id (defaults to X32). */
export const driverFor = (console) => DRIVERS[console] || DRIVERS.x32
/** Default network port for a console id. */
export const defaultPort = (console) => driverFor(console).port

/** Build the messages/frames for a channel list + console (sync). */
export const messagesFor = (channels, { console } = {}) => driverFor(console).build(channels)

/** Accept "localhost:4000"/"host" without a scheme — default to http://. */
export function normalizeApi(u) {
  const s = (u || '').trim().replace(/\/+$/, '')
  return s && !/^https?:\/\//i.test(s) ? `http://${s}` : s
}

const err = (message, code) => Object.assign(new Error(message), { code })

// ── token store (~/.pluggedin-bridge.json, keyed by API URL) ─────────────────
const STORE = path.join(os.homedir(), '.pluggedin-bridge.json')

async function readStore() {
  try {
    return JSON.parse(await readFile(STORE, 'utf8'))
  } catch {
    return {}
  }
}
async function writeStore(obj) {
  try {
    await writeFile(STORE, JSON.stringify(obj, null, 2), { mode: 0o600 })
  } catch {
    /* non-fatal: we just won't remember the token */
  }
}

const live = (e) => !!(e?.token && (!e.expiresAt || new Date(e.expiresAt) > new Date()))

/** The stored, unexpired token for `api`, or null. */
export async function getStoredToken(api) {
  const e = (await readStore())[normalizeApi(api)]
  return live(e) ? e.token : null
}
export async function storeToken(api, token, expiresAt, label) {
  const s = await readStore()
  s[normalizeApi(api)] = { token, expiresAt, label }
  await writeStore(s)
}
export async function clearToken(api) {
  const s = await readStore()
  delete s[normalizeApi(api)]
  await writeStore(s)
}

/** Paired state for an API: { api, paired, label }. */
export async function getState(api) {
  const normalized = normalizeApi(api)
  const e = (await readStore())[normalized]
  return { api: normalized, paired: live(e), label: e?.label || '' }
}

// ── API calls ────────────────────────────────────────────────────────────────
async function fetchJson(url, opts) {
  let res
  try {
    res = await fetch(url, opts)
  } catch {
    throw err(`Cannot reach the API. Check the URL and your network.`, 'unreachable')
  }
  return res
}

/** Exchange a pairing code for a scoped token; stores it. Returns { label }. */
export async function pair(api, code, label) {
  const a = normalizeApi(api)
  const res = await fetchJson(`${a}/api/bridge/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, label: label || os.hostname() }),
  })
  if (res.status === 429) throw err('Too many attempts — wait a few minutes and try again.', 'rate_limited')
  if (!res.ok)
    throw err('That pairing code was invalid or expired. Generate a new one in PluggedIn.', 'bad_code')
  const { token, expiresAt } = await res.json()
  await storeToken(a, token, expiresAt, label || os.hostname())
  return { label: label || os.hostname() }
}

async function authedGet(api, urlPath) {
  const a = normalizeApi(api)
  const token = await getStoredToken(a)
  if (!token) throw err('This device isn’t paired.', 'unpaired')
  const res = await fetchJson(`${a}${urlPath}`, { headers: { authorization: `Bearer ${token}` } })
  if (res.status === 401) {
    await clearToken(a)
    throw err('The saved token was rejected (expired or revoked) — pair again.', 'unpaired')
  }
  return res
}

/** Events the paired user can manage: [{ id, eventName, eventDate, venueName }]. */
export async function listEvents(api) {
  const res = await authedGet(api, '/api/bridge/events')
  if (!res.ok) throw err(`Could not list events (${res.status}).`)
  return res.json()
}

/**
 * Resolved console patch for an event: { eventName, channelCount, channels,
 * lineup:[{id,name}], ... }. Pass { requestId } to load a single band's patch
 * (mode 'slice' = on its master-patch channels [default]; 'standalone' = a fresh
 * 1..N scene) for re-patching between sets; omit it for the consolidated master.
 */
export async function loadPatch(api, eventId, { requestId = null, mode = 'slice' } = {}) {
  const qs = requestId ? `?requestId=${encodeURIComponent(requestId)}&mode=${encodeURIComponent(mode)}` : ''
  const res = await authedGet(api, `/api/bridge/events/${eventId}/patch${qs}`)
  if (res.status === 404) throw err('Event not found, or you don’t manage it.', 'not_found')
  if (!res.ok) throw err(`Could not load the patch (${res.status}).`)
  return res.json()
}

/** Read a previously exported patch JSON file (offline). */
export async function loadPatchFile(file) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw err(`Can’t read file: ${file}`, 'file')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw err('That file isn’t valid JSON.', 'file')
  }
}

/**
 * Send the patch's channels to the chosen console. OSC desks (X32/X-Air) go over
 * UDP; Yamaha (SCP) and Allen & Heath (MIDI) go over TCP. Returns the count sent.
 */
export async function push(channels, { desk, port, pace = 25, console } = {}) {
  if (!desk) throw err('No console IP.', 'no_desk')
  const drv = driverFor(console)
  const p = Number(port) || drv.port
  const pc = Number(pace) || 25
  const frames = drv.build(channels)
  if (!frames.length) throw err('Nothing to send — this patch has no channels.', 'empty')
  if (drv.transport === 'tcp') await sendFrames(frames, desk, p, { pace: pc })
  else await sendMessages(frames, desk, p, { pace: pc })
  return frames.length
}
