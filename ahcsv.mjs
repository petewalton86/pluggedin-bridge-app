// Allen & Heath dLive / Avantis "Show CSV" — the file you load via Director's
// (or the desk's) Import CSV. Far more reliable than MIDI-over-TCP naming: it
// reproduces the exact section layout A&H's Director *exports*, with the patch's
// channel names / colours / 48V filled into the Input rows.
//
// Layout (from a real Director export):
//   [Version],V1.0
//   [Channels]            Input×128, Group×10, Aux×10, Main×1, Wedge, IEM×2,
//                         FX Return×16, DCA×24, UFX×8, UFX Return×8
//   [Outputs]             MixRack→Group/Aux/Main socket map
//   [Virtual SoundCheck]  128 rows
// Every row is padded to 28 columns (27 commas), matching the export.

const COLS = 28
const NAME_MAX = 16

// PluggedIn 2-letter colour code → A&H Director colour word.
const COLOUR = {
  RD: 'Red',
  GN: 'Green',
  BL: 'Blue',
  YE: 'Yellow',
  CY: 'Cyan',
  MG: 'Purple',
  WH: 'White',
  OFF: 'Off',
}

// A&H's CSV parser is strict 7-bit ASCII and aborts (with a misleading
// "Line 1 / Version" fatal error) on non-ASCII or control characters in a name.
// So: drop anything outside printable ASCII (smart quotes, em-dashes, accents,
// CR/LF/tabs), collapse whitespace, clip to the name budget, then CSV-escape
// quotes. Falls back to the channel number if nothing printable remains.
const q = (s, fallback) => {
  const t = String(s ?? '')
    .replace(/[^\x20-\x7E]/g, '') // printable ASCII only
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .replace(/"/g, '""')
  return `"${t || fallback}"`
}
const row = (fields) => {
  const out = fields.slice(0, COLS).map((f) => (f == null ? '' : String(f)))
  while (out.length < COLS) out.push('')
  return out.join(',')
}

/**
 * Build a dLive/Avantis Import-CSV string from a bridge channel list.
 * @param channels [{ ch, name, color, phantom, overflow }]
 * @param opts.inputs  number of input slots to emit (default 128)
 * @returns {string} CSV text (CRLF line endings)
 *
 * NOTE: the input preamp booleans are `…,27,<Pad>,<48V>,…` — col 9 Pad, col 10
 * 48V (best-effort from the export; verify on first import and swap if needed).
 */
export function buildAhCsv(channels = [], { inputs = 128 } = {}) {
  const byCh = new Map()
  for (const c of channels) {
    if (c && !c.overflow && Number.isFinite(Number(c.ch))) byCh.set(Number(c.ch), c)
  }

  const lines = []
  lines.push(row(['[Version]', 'V1.0']))
  lines.push(row(['[Channels]']))

  // Inputs 1..N — patched names/colours/48V, defaults elsewhere.
  for (let n = 1; n <= inputs; n += 1) {
    const c = byCh.get(n)
    const socket = ((n - 1) % 64) + 1
    const colour = c ? COLOUR[c.color] || 'Green' : 'Green'
    const p48 = c?.phantom ? 'On' : 'Off'
    lines.push(
      row([
        'Input', n, q(c?.name, String(n)), colour, 'MixRack', socket, '', '27', 'Off', p48,
        'Unassigned', '', '', '', '', '', 'Unassigned', '', '', '', '', '', 'Unassigned',
      ]),
    )
  }

  // Master / bus channels — mirror the Director template defaults.
  const bus = (type, count, colour, withUnassigned = true, nameFn) => {
    for (let n = 1; n <= count; n += 1) {
      const base = [type, n, nameFn ? nameFn(n) : `"${n}"`, colour]
      if (withUnassigned) base.push('Unassigned')
      lines.push(row(base))
    }
  }
  bus('Group', 10, 'Blue')
  bus('Aux', 10, 'Cyan')
  bus('Main', 1, 'Yellow')
  lines.push(row(['Wedge', 1, '"Wedge"', 'Red']))
  lines.push(row(['IEM', 1, '"IEM"', 'Red']))
  lines.push(row(['IEM', 1, '"IEM"', 'Red']))
  bus('FX Return', 16, 'Green', false)
  bus('DCA', 24, 'Red', false)
  bus('UFX', 8, 'Cyan', false)
  bus('UFX Return', 8, 'Green', false)

  // Output socket map.
  lines.push(row(['[Outputs]']))
  for (let n = 1; n <= 10; n += 1) lines.push(row(['MixRack', n, 'Group', n]))
  for (let n = 1; n <= 10; n += 1) lines.push(row(['MixRack', 10 + n, 'Aux', n]))
  lines.push(row(['MixRack', 21, 'Main', 1]))
  lines.push(row(['MixRack', 22, 'Main', 2]))

  // Virtual soundcheck map.
  lines.push(row(['[Virtual SoundCheck]']))
  for (let n = 1; n <= inputs; n += 1) lines.push(row([n, n, 'IO 4']))

  return `${lines.join('\r\n')}\r\n`
}
