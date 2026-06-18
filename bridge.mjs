#!/usr/bin/env node
// PluggedIn desk bridge — push an event's master patch to a Behringer X32 /
// Midas M32 live over OSC. Run this on the FOH laptop (same network as the
// desk). It pulls the resolved channel list from the PluggedIn API (or an
// exported --in file) and sets each channel's name, colour, source and 48V.
//
// Run with NO options to be prompted for everything (double-click friendly):
//   pluggedin-bridge
// Or pass flags / env vars:
//   node bridge.mjs --event <id> --desk 192.168.0.10 --email you@x --password ****

import readline from 'node:readline'
import { readFile } from 'node:fs/promises'
import { buildMessages } from './x32.mjs'
import { sendMessages } from './udp.mjs'

const HELP = `PluggedIn Desk Bridge — preload an X32/M32 from an event's master patch.

Usage:
  pluggedin-bridge [options]

Run with no options to be prompted for each value.

Options:
  --event <id>           Event id
  --desk <ip>            Console IP (omit and use --dry-run to preview)
  --port <n>             OSC port (default 10023; X-Air uses 10024)
  --api <url>            PluggedIn API base (default http://localhost:4000)
  --token <jwt>          Session token (instead of email/password)
  --email <e>            Sign-in email
  --password <p>         Sign-in password
  --in <file.json>       Use an exported patch file instead of the API
  --pace <ms>            Delay between OSC messages (default 25)
  --dry-run              Print the OSC messages instead of sending
  -h, --help             Show this help

Env vars: PI_API PI_EVENT PI_DESK PI_DESK_PORT PI_TOKEN PI_EMAIL PI_PASSWORD`

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

// Accept "localhost:4000" or "host" without a scheme — default to http://.
const normalizeApi = (u) => {
  const s = (u || '').trim().replace(/\/+$/, '')
  return s && !/^https?:\/\//i.test(s) ? `http://${s}` : s
}

if (args.help) {
  console.log(HELP)
  process.exit(0)
}

// ---- prompting -------------------------------------------------------------
function ask(query, { def = '' } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(def ? `${query} [${def}]: ` : `${query}: `, (a) => {
      rl.close()
      resolve((a || '').trim() || def)
    })
  })
}

function askHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    let muted = false
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s) // the prompt prints; keystrokes are hidden
    }
    rl.question(`${query}: `, (a) => {
      rl.close()
      process.stdout.write('\n')
      resolve((a || '').trim())
    })
    muted = true
  })
}

// ---- error handling --------------------------------------------------------
async function die(msg) {
  console.error(`\n✖ ${msg}`)
  if (interactive) await ask('\nPress Enter to close')
  process.exit(1)
}

// ---- config ----------------------------------------------------------------
async function gather() {
  const cfg = {
    api: normalizeApi(args.api || env.PI_API || 'http://localhost:4000'),
    eventId: args.event || env.PI_EVENT,
    desk: args.desk || env.PI_DESK,
    port: Number(args.port || env.PI_DESK_PORT || 10023),
    pace: Number(args.pace || 25),
    dryRun: Boolean(args['dry-run']),
    token: args.token || env.PI_TOKEN,
    email: args.email || env.PI_EMAIL,
    password: args.password || env.PI_PASSWORD,
    inFile: args.in || env.PI_IN,
  }

  if (interactive && !cfg.inFile) {
    if (args.api === undefined && !env.PI_API)
      cfg.api = normalizeApi(await ask('PluggedIn API URL', { def: cfg.api }))
    if (!cfg.token) {
      if (!cfg.email) cfg.email = await ask('Email')
      if (!cfg.password) cfg.password = await askHidden('Password')
    }
    if (!cfg.eventId) cfg.eventId = await ask('Event id')
    if (!cfg.desk && !cfg.dryRun) {
      cfg.desk = await ask('Console IP (blank to preview only)')
      if (!cfg.desk) cfg.dryRun = true
    }
  }
  return cfg
}

// ---- API -------------------------------------------------------------------
async function login(cfg) {
  const res = await fetch(`${cfg.api}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  }).catch(() => null)
  if (!res) return die(`Cannot reach the API at ${cfg.api}. Is the URL correct?`)
  if (!res.ok) return die(`Login failed (${res.status}). Check your email/password.`)
  return (await res.json()).token
}

async function fetchPatch(cfg) {
  const res = await fetch(`${cfg.api}/api/events/${cfg.eventId}/console-patch`, {
    headers: { authorization: `Bearer ${cfg.token}` },
  }).catch(() => null)
  if (!res) return die(`Cannot reach the API at ${cfg.api}.`)
  if (res.status === 401) return die('Session expired or invalid — sign in again.')
  if (res.status === 404) return die('Event not found, or you don’t co-manage it.')
  if (!res.ok) return die(`Could not load the patch (${res.status}).`)
  return res.json()
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
  if (!cfg.eventId) return die('No event id (use --event or run interactively).')
  if (!cfg.token) {
    if (!cfg.email || !cfg.password)
      return die('Provide --token, or --email and --password (or run interactively).')
    process.stdout.write('Signing in… ')
    cfg.token = await login(cfg)
    console.log('ok')
  }
  process.stdout.write(`Loading patch for event ${cfg.eventId}… `)
  const patch = await fetchPatch(cfg)
  console.log('ok')
  return patch
}

// ---- main ------------------------------------------------------------------
async function main() {
  const cfg = await gather()
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

  if (cfg.dryRun || (!cfg.desk && cfg.inFile)) {
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
