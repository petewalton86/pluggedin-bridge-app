// Allen & Heath SQ / dLive·Avantis — channel naming over "MIDI over TCP" (raw
// MIDI bytes on TCP 51325). We send one channel-name SysEx per channel.
//
// EXPERIMENTAL: the SysEx headers below follow A&H's published MIDI protocols
// (manufacturer id 00 00 1A) but are NOT bench-verified. If names don't land,
// confirm the header + name-payload layout against the MIDI protocol PDF for
// your console and adjust the FAMILY table — that's the only thing to change.

// F0 00 00 1A <model/section bytes…> <channel> <ascii name…> F7
const FAMILY = {
  sq: { header: [0x00, 0x00, 0x1a, 0x50, 0x11, 0x01, 0x00, 0x03], nameMax: 8 },
  dlive: { header: [0x00, 0x00, 0x1a, 0x4e, 0x10, 0x01, 0x00, 0x03], nameMax: 12 },
}

// 7-bit ASCII bytes for a name, clipped to the family's budget.
const asciiBytes = (s, n) =>
  Array.from(String(s || '').slice(0, n), (c) => c.charCodeAt(0) & 0x7f)

/**
 * @param channels [{ ch, name, overflow }]
 * @param family   'sq' | 'dlive'
 * @returns {Buffer[]} one channel-name SysEx frame per channel
 */
export function buildMessages(channels, family = 'sq') {
  const fam = FAMILY[family] || FAMILY.sq
  const frames = []
  for (const c of channels || []) {
    if (c.overflow) continue
    const ch = (c.ch - 1) & 0x7f
    frames.push(Buffer.from([0xf0, ...fam.header, ch, ...asciiBytes(c.name, fam.nameMax), 0xf7]))
  }
  return frames
}
