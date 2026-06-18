// Framework-agnostic desk-bridge core: pairing, token storage, event/patch
// fetch, and OSC push. No prompts, no process.exit — functions return values or
// throw Error(message) (with an optional `.code`). Shared by the Electron main
// process (and any future CLI). The browser/renderer never imports this.

import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { buildMessages } from './x32.mjs'
import { sendMessages } from './udp.mjs'

export { buildMessages, sendMessages }

/** Build OSC messages for a channel list (sync). */
export const messagesFor = (channels) => buildMessages(channels)

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

/** Resolved console patch for an event: { eventName, channelCount, channels }. */
export async function loadPatch(api, eventId) {
  const res = await authedGet(api, `/api/bridge/events/${eventId}/patch`)
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

/** Send the patch's channels to the desk over OSC. Returns the message count. */
export async function push(channels, { desk, port = 10023, pace = 25 } = {}) {
  if (!desk) throw err('No console IP.', 'no_desk')
  const messages = buildMessages(channels)
  if (!messages.length) throw err('Nothing to send — this patch has no channels.', 'empty')
  await sendMessages(messages, desk, Number(port) || 10023, { pace: Number(pace) || 25 })
  return messages.length
}
