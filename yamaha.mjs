// Yamaha CL / QL (and Rivage PM / DM, which share RCP) remote control via SCP —
// the "Simple Control Protocol": newline-terminated ASCII commands over TCP
// 49280. We set each input channel's Name, Colour and head-amp 48V.
//
// BETA: built to Yamaha's published RCP/SCP parameter list but not bench-tested
// here. If something doesn't land, the three command templates + colour map
// below are the only things to adjust.

const NAME_MAX = 12
const clip = (s) => String(s || '').slice(0, NAME_MAX)
const esc = (s) => clip(s).replace(/"/g, "'")

// Our colour enum → a Yamaha channel-colour name.
const YCOLOR = {
  RD: 'Red',
  GN: 'Green',
  YE: 'Yellow',
  BL: 'Blue',
  MG: 'Magenta',
  CY: 'Cyan',
  WH: 'White',
  OFF: 'Black',
}

/**
 * @param channels [{ ch, name, color, phantom, overflow }]
 * @returns {string[]} SCP command lines (one TCP frame each, 0-indexed channel)
 */
export function buildMessages(channels) {
  const lines = []
  for (const c of channels || []) {
    if (c.overflow) continue
    const ch = c.ch - 1 // SCP input channels are 0-indexed
    lines.push(`set MIXER:Current/InCh/Label/Name ${ch} 0 "${esc(c.name)}"\n`)
    lines.push(`set MIXER:Current/InCh/Label/Color ${ch} 0 "${YCOLOR[c.color] || 'White'}"\n`)
    lines.push(`set MIXER:Current/InCh/HA/48V ${ch} 0 ${c.phantom ? 1 : 0}\n`)
  }
  return lines
}
