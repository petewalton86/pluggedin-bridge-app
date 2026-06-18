'use strict'

const $ = (id) => document.getElementById(id)
const B = window.bridge

// Default PluggedIn API. Change this ONE line to the hosted URL once the live
// app is deployed (e.g. 'https://api.pluggedin.app') and rebuild — users then
// never see/type it; the Advanced field only overrides it.
const DEFAULT_API = 'http://localhost:4000'

const COLORS = {
  OFF: '#64748b', RD: '#ef4444', GN: '#22c55e', YE: '#eab308',
  BL: '#3b82f6', MG: '#d946ef', CY: '#06b6d4', WH: '#e5e7eb',
}

const store = {
  get: (k, d) => localStorage.getItem(k) ?? d,
  set: (k, v) => localStorage.setItem(k, v),
}

let patch = null // current { eventName, channelCount, channels }

const api = () => $('api').value.trim() || DEFAULT_API

// Unwrap the { ok, data, error } envelope from the main process.
async function call(promise) {
  const r = await promise
  if (!r || !r.ok) {
    const e = new Error(r?.error || 'Something went wrong')
    e.code = r?.code
    throw e
  }
  return r.data
}

function show(screen) {
  $('screen-pair').hidden = screen !== 'pair'
  $('screen-main').hidden = screen !== 'main'
}

function status(msg, kind) {
  const el = $('status')
  if (!msg) {
    el.hidden = true
    return
  }
  el.hidden = false
  el.textContent = msg
  el.className = 'status' + (kind ? ' ' + kind : '')
}

// ── pairing ──────────────────────────────────────────────────────────────────
async function refreshState() {
  try {
    const st = await call(B.state(api()))
    if (st.paired) {
      $('device').textContent = st.label ? `Paired: ${st.label}` : 'Paired'
      show('main')
      await loadEvents()
    } else {
      show('pair')
    }
  } catch {
    show('pair')
  }
}

async function doPair() {
  $('pair-error').hidden = true
  const code = $('code').value.trim()
  if (!code) return
  $('pair-btn').disabled = true
  $('pair-btn').textContent = 'Pairing…'
  try {
    store.set('pi_api', api())
    await call(B.pair(api(), code))
    $('code').value = ''
    await refreshState()
  } catch (e) {
    $('pair-error').textContent = e.message
    $('pair-error').hidden = false
  } finally {
    $('pair-btn').disabled = false
    $('pair-btn').textContent = 'Pair this device'
  }
}

async function forget() {
  try {
    await call(B.forget(api()))
  } catch {
    /* ignore */
  }
  patch = null
  $('channels').innerHTML = ''
  $('summary').textContent = ''
  $('warnings').innerHTML = ''
  status('')
  show('pair')
}

// ── events + patch ─────────────────────────────────────────────────────────
async function loadEvents() {
  const sel = $('event')
  try {
    const events = await call(B.events(api()))
    sel.innerHTML = ''
    if (!events.length) {
      sel.innerHTML = '<option value="">No events found</option>'
      return
    }
    for (const e of events) {
      const opt = document.createElement('option')
      opt.value = e.id
      opt.textContent =
        `${e.eventDate || '—'}  ${e.eventName}` + (e.venueName ? ` · ${e.venueName}` : '')
      sel.appendChild(opt)
    }
    await loadPatch(sel.value)
  } catch (e) {
    if (e.code === 'unpaired') return show('pair')
    status(e.message, 'err')
  }
}

async function loadPatch(eventId) {
  if (!eventId) return
  status('Loading patch…', 'busy')
  try {
    patch = await call(B.patch(api(), eventId))
    renderPatch()
    status('')
  } catch (e) {
    if (e.code === 'unpaired') return show('pair')
    status(e.message, 'err')
  }
}

function renderPatch() {
  const channels = patch?.channels || []
  const liveCh = channels.filter((c) => !c.overflow)
  const skipped = channels.length - liveCh.length
  const conflicts = liveCh.filter((c) => c.conflict).length

  $('summary').textContent = patch
    ? `${patch.eventName || 'Event'} — ${liveCh.length} channel(s)` +
      (patch.channelCount ? ` on a ${patch.channelCount}-ch desk` : '')
    : ''

  const warn = $('warnings')
  warn.innerHTML = ''
  if (skipped > 0) warn.appendChild(warnEl(`${skipped} channel(s) beyond the desk size are left out.`))
  if (conflicts > 0)
    warn.appendChild(warnEl(`${conflicts} channel(s) differ (mic/DI or 48V) across bands — review.`))

  const list = $('channels')
  list.innerHTML = ''
  for (const c of liveCh) {
    const row = document.createElement('div')
    row.className = 'chan'
    row.innerHTML =
      `<span class="num">${String(c.ch).padStart(2, '0')}</span>` +
      `<span class="swatch" style="background:${COLORS[c.color] || COLORS.WH}"></span>` +
      `<span class="name"></span>` +
      (c.phantom ? `<span class="v48">48V</span>` : '')
    row.querySelector('.name').textContent = c.name || ''
    list.appendChild(row)
  }
}

function warnEl(text) {
  const d = document.createElement('div')
  d.className = 'warn'
  d.textContent = text
  return d
}

// ── preview + push ───────────────────────────────────────────────────────────
async function preview() {
  if (!patch?.channels?.length) return status('Nothing to preview yet.', 'err')
  try {
    const msgs = await call(B.preview(patch.channels))
    status(`Preview: ${msgs.length} OSC messages (not sent).`, 'busy')
  } catch (e) {
    status(e.message, 'err')
  }
}

async function push() {
  if (!patch?.channels?.length) return status('Load an event or patch file first.', 'err')
  const desk = $('desk').value.trim()
  if (!desk) return status('Enter the console IP first.', 'err')
  const port = $('port').value.trim() || '10023'
  store.set('pi_desk', desk)
  store.set('pi_port', port)
  $('push-btn').disabled = true
  status(`Pushing to ${desk}:${port}…`, 'busy')
  try {
    const n = await call(B.push(patch.channels, { desk, port, pace: 25 }))
    status(`Pushed ${n} OSC messages ✓`, 'ok')
  } catch (e) {
    status(e.message, 'err')
  } finally {
    $('push-btn').disabled = false
  }
}

async function loadFile() {
  try {
    const p = await call(B.patchFile())
    if (!p) return
    patch = p
    $('event').innerHTML = `<option>${(p.eventName || 'Loaded file')}</option>`
    renderPatch()
    status('Loaded patch from file.', 'busy')
  } catch (e) {
    status(e.message, 'err')
  }
}

// ── wire up ───────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  $('api').value = store.get('pi_api', DEFAULT_API)
  $('desk').value = store.get('pi_desk', '')
  $('port').value = store.get('pi_port', '10023')

  $('pair-btn').addEventListener('click', doPair)
  $('code').addEventListener('keydown', (e) => e.key === 'Enter' && doPair())
  $('refresh').addEventListener('click', loadEvents)
  $('event').addEventListener('change', (e) => loadPatch(e.target.value))
  $('preview-btn').addEventListener('click', preview)
  $('push-btn').addEventListener('click', push)
  $('loadfile').addEventListener('click', loadFile)
  $('forget').addEventListener('click', forget)

  refreshState()
})
