#!/usr/bin/env node
// PluggedIn desk bridge — preload a Behringer X32 / Midas M32 from an event's
// master patch over OSC. Runs on the FOH laptop (same network as the desk).
//
// Auth is a one-time PAIRING: in PluggedIn, open Send to desk → Connect a bridge
// to get a short code; type it here once and this device is remembered with a
// scoped, revocable, read-only token (your account password is never used).
//
//   pluggedin-bridge                 # prompts: pair (first run), pick event, desk IP
//   pluggedin-bridge --dry-run       # preview without a desk
//   pluggedin-bridge --in patch.json --desk 192.168.0.10   # fully offline

import readline from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { buildMessages } from './x32.mjs'
import { sendMessages } from './udp.mjs'

const HELP = `PluggedIn Desk Bridge — preload an X32/M32 from an event's master patch.

Usage:
  pluggedin-bridge [options]

First run prompts for a pairing code (PluggedIn → Send to desk → Connect a
bridge), then remembers this device. Later runs just pick an event and push.

Options:
  --event <id>           Event id (skip the picker)
  --desk <ip>            Console IP (omit and use --dry-run to preview)
  --port <n>             OSC port (default 10023; X-Air uses 10024)
  --api <url>            PluggedIn API base (default http://localhost:4000)
  --code <pairing-code>  Pair non-interactively with this code
  --token <bridge-token> Use a bridge token directly (skip pairing/storage)
  --label <name>         Label this device in PluggedIn (default: hostname)
  --reset                Forget the saved token for this API and re-pair
  --in <file.json>       Use an exported patch file instead of the API
  --pace <ms>            Delay between OSC messages (default 25)
  --dry-run              Print the OSC messages instead of sending
  -h, --help             Show this help

Env: PI_API PI_EVENT PI_DESK PI_DESK_PORT PI_TOKEN PI_CODE PI_LABEL PI_IN`

function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i]
    if (k === '-h' || k === '--help') {
      a.help = true
      continue
    }
    if (!k.startsWith('--')) continue
    const key = k.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) a[key] = true
    else {
      a[key] = next
      i += 1
    }
  }
  return a
}

const args = parseArgs(process.argv.slice(2))
const env = process.env
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)

if (args.help) {
  console.log(HELP)
  process.exit(0)
}

// Accept "localhost:4000" / "host" without a scheme — default to http://.
const normalizeApi = (u) => {
  const s = (u || '').trim().replace(/\/+$/, '')
  return s && !/^https?:\/\//i.test(s) ? `http://${s}` : s
}

// ── prompting ───────────────────────────────────────────────────────────────
function ask(query, { def = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(def ? `${query} [${def}]: ` : `${query}: `, (a) => {
      rl.close()
      resolve((a || '').trim() || def)
    })
  })
}

async function die(msg) {
  console.error(`\n✖ ${msg}`)
  if (interactive) await ask('\nPress Enter to close')
  process.exit(1)
}

// ── token storage (~/.pluggedin-bridge.json, keyed by API URL) ───────────────
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
async function getStoredToken(api) {
  const e = (await readStore())[api]
  if (e?.token && (!e.expiresAt || new Date(e.expiresAt) > new Date())) return e.token
  return null
}
async function storeToken(api, token, expiresAt) {
  const s = await readStore()
  s[api] = { token, expiresAt }
  await writeStore(s)
}
async function clearToken(api) {
  const s = await readStore()
  delete s[api]
  await writeStore(s)
}

// ── pairing + authed requests ────────────────────────────────────────────────
async function pair(cfg, code) {
  const res = await fetch(`${cfg.api}/api/bridge/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, label: cfg.label || os.hostname() }),
  }).catch(() => null)
  if (!res) return die(`Cannot reach the API at ${cfg.api}. Is the URL correct?`)
  if (res.status === 429) return die('Too many attempts — wait a few minutes and try again.')
  if (!res.ok)
    return die(
      'That pairing code was invalid or expired. Generate a new one in PluggedIn\n(Send to desk → Connect a bridge).',
    )
  return res.json() // { token, expiresAt }
}

async function ensureToken(cfg) {
  if (cfg.token) return cfg.token
  const saved = await getStoredToken(cfg.api)
  if (saved) return saved
  let code = cfg.code
  if (!code) {
    if (!interactive)
      return die('This device isn’t paired. Run once interactively, or pass --code <pairing-code>.')
    console.log('\nThis device isn’t paired yet.')
    console.log('In PluggedIn: Send to desk → Connect a bridge → generate a pairing code.')
    code = await ask('Enter pairing code')
  }
  const { token, expiresAt } = await pair(cfg, code)
  await storeToken(cfg.api, token, expiresAt)
  console.log('Paired ✓ — this device is remembered.')
  return token
}

// GET with the bridge token; on 401 forget the token and re-pair once.
async function authedGet(cfg, urlPath) {
  let token = await ensureToken(cfg)
  let res = await fetch(`${cfg.api}${urlPath}`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null)
  if (res && res.status === 401 && !cfg.token) {
    await clearToken(cfg.api)
    console.log('\nSaved token expired or revoked — re-pairing.')
    token = await ensureToken(cfg)
    res = await fetch(`${cfg.api}${urlPath}`, {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null)
  }
  if (!res) return die(`Cannot reach the API at ${cfg.api}.`)
  if (res.status === 401) return die('Bridge token rejected (expired or revoked).')
  return res
}

// ── config ───────────────────────────────────────────────────────────────────
async function gather() {
  const cfg = {
    api: normalizeApi(args.api || env.PI_API || 'http://localhost:4000'),
    eventId: args.event || env.PI_EVENT,
    desk: args.desk || env.PI_DESK,
    port: Number(args.port || env.PI_DESK_PORT || 10023),
    pace: Number(args.pace || 25),
    dryRun: Boolean(args['dry-run']),
    token: args.token || env.PI_TOKEN,
    code: args.code || env.PI_CODE,
    label: args.label || env.PI_LABEL,
    inFile: args.in || env.PI_IN,
  }
  if (interactive && !cfg.inFile) {
    if (args.api === undefined && !env.PI_API)
      cfg.api = normalizeApi(await ask('PluggedIn API URL', { def: cfg.api }))
    if (!cfg.desk && !cfg.dryRun) {
      cfg.desk = await ask('Console IP (blank to preview only)')
      if (!cfg.desk) cfg.dryRun = true
    }
  }
  return cfg
}

async function pickEvent(cfg) {
  if (cfg.eventId) return cfg.eventId
  const res = await authedGet(cfg, '/api/bridge/events')
  if (!res.ok) return die(`Could not list events (${res.status}).`)
  const events = await res.json()
  if (!events.length) return die('No events found for your account.')
  if (events.length === 1) {
    console.log(`\nUsing your only event: ${events[0].eventName}`)
    return events[0].id
  }
  if (!interactive) return die('Multiple events — pass --event <id> in non-interactive mode.')
  console.log('\nYour events:')
  events.forEach((e, i) =>
    console.log(
      `  ${i + 1}) ${e.eventDate || '—'}  ${e.eventName}${e.venueName ? ` · ${e.venueName}` : ''}`,
    ),
  )
  const idx = Number(await ask(`Choose an event [1-${events.length}]`)) - 1
  if (!(idx >= 0 && idx < events.length)) return die('Invalid choice.')
  return events[idx].id
}

async function loadPatch(cfg) {
  if (cfg.inFile) {
    const text = await readFile(cfg.inFile, 'utf8').catch(() => die(`Can’t read file: ${cfg.inFile}`))
    try {
      return JSON.parse(text)
    } catch {
      return die(`${cfg.inFile} isn’t valid JSON.`)
    }
  }
  const eventId = await pickEvent(cfg)
  process.stdout.write(`Loading patch… `)
  const res = await authedGet(cfg, `/api/bridge/events/${eventId}/patch`)
  if (res.status === 404) return die('Event not found, or you don’t manage it.')
  if (!res.ok) return die(`Could not load the patch (${res.status}).`)
  console.log('ok')
  return res.json()
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = await gather()
  if (args.reset) {
    await clearToken(cfg.api)
    console.log('Forgot the saved token for this API.')
  }
  if (!cfg.desk && !cfg.dryRun && !cfg.inFile && !interactive)
    return die('Missing --desk <console-ip>. Use --dry-run to preview.')

  const patch = await loadPatch(cfg)
  const channels = patch.channels || []
  const live = channels.filter((c) => !c.overflow)
  const skipped = channels.length - live.length

  console.log(
    `\n${patch.eventName || 'Event'} — ${live.length} channel(s)` +
      (patch.channelCount ? ` on a ${patch.channelCount}-ch desk` : ''),
  )
  for (const c of live) {
    console.log(
      `  ${String(c.ch).padStart(2, '0')}  ${String(c.name).padEnd(14)} ${c.color}` +
        (c.phantom ? '  48V' : ''),
    )
  }
  if (skipped > 0) console.log(`  (${skipped} channel(s) beyond the desk size were skipped)`)

  const messages = buildMessages(channels)
  if (!messages.length) return die('Nothing to send — build/save a master patch for this event first.')

  if (cfg.dryRun || !cfg.desk) {
    console.log(`\n[dry-run] ${messages.length} OSC messages (not sent):`)
    for (const m of messages)
      console.log(`  ${m.address} ${m.args.map((a) => JSON.stringify(a.value)).join(' ')}`)
  } else {
    process.stdout.write(`\nPushing ${messages.length} OSC messages to ${cfg.desk}:${cfg.port}… `)
    await sendMessages(messages, cfg.desk, cfg.port, { pace: cfg.pace })
    console.log('done ✓')
    console.log(
      '\nReview the names/48V on the desk. Tip: push before dialling the mix, or use the' +
        '\nconsole’s recall scope (Config/Preamp) so it only sets names, colours and 48V.',
    )
  }

  if (interactive) await ask('\nPress Enter to close')
}

main().catch((e) => die(e?.message || String(e)))
