// Minimal OSC 1.0 message encoder (no dependencies). Enough for X32/M32:
// string / int32 / float32 arguments, each null-terminated/padded to 4 bytes.

function oscString(str) {
  const s = Buffer.from(String(str), 'ascii')
  const total = s.length + 1 // + null terminator
  const pad = (4 - (total % 4)) % 4
  return Buffer.concat([s, Buffer.alloc(1 + pad)]) // trailing bytes are zero
}

function oscInt(n) {
  const b = Buffer.alloc(4)
  b.writeInt32BE(n | 0)
  return b
}

function oscFloat(n) {
  const b = Buffer.alloc(4)
  b.writeFloatBE(Number(n))
  return b
}

/**
 * Encode an OSC message.
 * @param {string} address e.g. "/ch/01/config/name"
 * @param {{type:'s'|'i'|'f', value:any}[]} args
 * @returns {Buffer}
 */
export function encode(address, args = []) {
  const tag = ',' + args.map((a) => a.type).join('')
  const parts = [oscString(address), oscString(tag)]
  for (const a of args) {
    if (a.type === 's') parts.push(oscString(a.value))
    else if (a.type === 'i') parts.push(oscInt(a.value))
    else if (a.type === 'f') parts.push(oscFloat(a.value))
    else throw new Error(`Unsupported OSC type: ${a.type}`)
  }
  return Buffer.concat(parts)
}
