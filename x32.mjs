// Map a resolved console channel list (from GET /api/events/:id/console-patch)
// into ordered OSC messages for a Behringer X32 / Midas M32. We set, per
// channel: name, colour, source (local input N) and the feeding head amp's
// phantom. Names are clipped to the 12-char scribble strip.

// X32 OSC /config/color enum (0..7; 8..15 are the inverted variants).
export const COLOR_INDEX = { OFF: 0, RD: 1, GN: 2, YE: 3, BL: 4, MG: 5, CY: 6, WH: 7 }

const NAME_MAX = 12
const pad2 = (n) => String(n).padStart(2, '0')
const pad3 = (n) => String(n).padStart(3, '0')
const clip = (s) => String(s || '').slice(0, NAME_MAX)

/**
 * @param channels [{ ch, name, color, source, phantom, overflow }]
 * @returns {{address:string, args:{type:string,value:any}[]}[]} ordered OSC messages
 */
export function buildMessages(channels) {
  const msgs = []
  for (const c of channels || []) {
    if (c.overflow) continue
    const nn = pad2(c.ch)
    const src = c.source || c.ch
    msgs.push({ address: `/ch/${nn}/config/name`, args: [{ type: 's', value: clip(c.name) }] })
    msgs.push({
      address: `/ch/${nn}/config/color`,
      args: [{ type: 'i', value: COLOR_INDEX[c.color] ?? COLOR_INDEX.WH }],
    })
    msgs.push({ address: `/ch/${nn}/config/source`, args: [{ type: 'i', value: src }] })
    msgs.push({
      address: `/headamp/${pad3(src - 1)}/phantom`,
      args: [{ type: 'i', value: c.phantom ? 1 : 0 }],
    })
  }
  return msgs
}
