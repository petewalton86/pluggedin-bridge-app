// Behringer X-Air / Midas M-Air (XR12/16/18, MR18) OSC driver. Same dialect as
// the X32 for name + colour; the head-amp index is 2-digit and we leave input
// routing alone (X-Air patch addressing differs). Up to 16 mono channels.
import { COLOR_INDEX } from './x32.mjs'

const NAME_MAX = 12
const XAIR_MAX_CH = 16
const pad2 = (n) => String(n).padStart(2, '0')
const clip = (s) => String(s || '').slice(0, NAME_MAX)

/**
 * @param channels [{ ch, name, color, phantom, overflow }]
 * @returns {{address:string, args:{type:string,value:any}[]}[]} ordered OSC messages
 */
export function buildMessages(channels) {
  const msgs = []
  for (const c of channels || []) {
    if (c.overflow || c.ch > XAIR_MAX_CH) continue
    const nn = pad2(c.ch)
    msgs.push({ address: `/ch/${nn}/config/name`, args: [{ type: 's', value: clip(c.name) }] })
    msgs.push({
      address: `/ch/${nn}/config/color`,
      args: [{ type: 'i', value: COLOR_INDEX[c.color] ?? COLOR_INDEX.WH }],
    })
    msgs.push({
      address: `/headamp/${pad2(c.ch - 1)}/phantom`,
      args: [{ type: 'i', value: c.phantom ? 1 : 0 }],
    })
  }
  return msgs
}
