// Headless tests for the bridge core. Run: node core.test.mjs
import dgram from 'node:dgram'
import os from 'node:os'
import path from 'node:path'
import { mkdtempSync } from 'node:fs'
import { encode } from './osc.mjs'

// Isolate the token store under a temp HOME *before* importing core (it computes
// the store path from os.homedir() at load time).
const tmp = mkdtempSync(path.join(os.tmpdir(), 'pgb-'))
process.env.HOME = tmp
process.env.USERPROFILE = tmp
const core = await import('./core.mjs')
const { buildMessages, sendMessages, normalizeApi } = core

let failed = 0
const ok = (name, cond) => {
  console.log(`${cond ? '\x1b[32m✓' : '\x1b[31m✗'}\x1b[0m ${name}`)
  if (!cond) failed += 1
}
const oscAddress = (buf) => {
  const end = buf.indexOf(0)
  return buf.slice(0, end < 0 ? buf.length : end).toString('ascii')
}

// 1. OSC encoding
{
  const b = encode('/foo', [{ type: 's', value: 'bar' }])
  ok('osc string message padded to 4-byte boundary', b.length === 16)
  ok('osc address preserved', oscAddress(b) === '/foo')
  const c = encode('/ch/01/config/color', [{ type: 'i', value: 3 }])
  ok('osc int32 big-endian', c.readInt32BE(c.length - 4) === 3)
}

// 2. X32 message mapping (via the core re-export)
{
  const channels = [
    { ch: 1, name: 'Kick', color: 'YE', source: 1, phantom: false },
    { ch: 2, name: 'Lead Vox very long', color: 'RD', source: 2, phantom: true },
    { ch: 3, name: 'Skip', color: 'WH', source: 3, phantom: false, overflow: true },
  ]
  const m = buildMessages(channels)
  ok('overflow channel skipped (2 ch × 4 msgs = 8)', m.length === 8)
  ok('ch1 name', m[0].address === '/ch/01/config/name' && m[0].args[0].value === 'Kick')
  ok('ch1 colour YE→3', m[1].address === '/ch/01/config/color' && m[1].args[0].value === 3)
  ok('ch1 source', m[2].address === '/ch/01/config/source' && m[2].args[0].value === 1)
  ok('ch1 phantom OFF on headamp 000', m[3].address === '/headamp/000/phantom' && m[3].args[0].value === 0)
  ok('ch2 name clipped to 12', m[4].args[0].value === 'Lead Vox ver')
  ok('ch2 colour RD→1', m[5].args[0].value === 1)
  ok('ch2 phantom ON on headamp 001', m[7].address === '/headamp/001/phantom' && m[7].args[0].value === 1)
}

// 3. core token store (isolated temp HOME) + normalizeApi
{
  ok('normalizeApi adds scheme', normalizeApi('localhost:4000') === 'http://localhost:4000')
  ok('normalizeApi strips trailing slash', normalizeApi('http://h/') === 'http://h')
  await core.storeToken('localhost:4000', 'tok_abc', null, 'FOH')
  const st = await core.getState('http://localhost:4000/') // variants normalise to one key
  ok('getState paired after store', st.paired === true && st.label === 'FOH')
  ok('getStoredToken returns the token', (await core.getStoredToken('localhost:4000')) === 'tok_abc')
  await core.clearToken('localhost:4000')
  ok('clearToken forgets it', (await core.getStoredToken('localhost:4000')) === null)
  await core.storeToken('h', 'old', new Date(Date.now() - 1000).toISOString(), 'x')
  ok('expired token is ignored', (await core.getStoredToken('h')) === null)
}

// 4. UDP delivery to a local listener (via the core re-export)
await new Promise((resolve) => {
  const server = dgram.createSocket('udp4')
  const got = []
  const timer = setTimeout(() => {
    ok('UDP: delivered within timeout', false)
    try {
      server.close()
    } catch {
      /* noop */
    }
    resolve()
  }, 3000)
  server.on('message', (msg) => {
    got.push(msg)
    if (got.length === 8) {
      clearTimeout(timer)
      ok('UDP: all 8 messages delivered', got.length === 8)
      ok('UDP: first datagram is ch1 name', oscAddress(got[0]) === '/ch/01/config/name')
      server.close()
      resolve()
    }
  })
  server.bind(0, '127.0.0.1', async () => {
    const { port } = server.address()
    const channels = [
      { ch: 1, name: 'Kick', color: 'YE', source: 1, phantom: false },
      { ch: 2, name: 'Vox', color: 'RD', source: 2, phantom: true },
    ]
    await sendMessages(buildMessages(channels), '127.0.0.1', port, { pace: 1 })
  })
})

// 5. Multi-console drivers via messagesFor(channels, { console })
{
  const ch = [
    { ch: 1, name: 'Kick', color: 'YE', source: 1, phantom: false },
    { ch: 2, name: 'Lead Vocal long', color: 'RD', source: 2, phantom: true },
    { ch: 17, name: 'Beyond', color: 'WH', phantom: false }, // > X-Air 16ch
    { ch: 3, name: 'Skip', color: 'WH', overflow: true },
  ]

  // X-Air (OSC, port 10024): name/colour/phantom, 2-digit head amp, caps at 16.
  ok('defaultPort xair = 10024', core.defaultPort('xair') === 10024)
  const xa = core.messagesFor(ch, { console: 'xair' })
  ok('xair: 2 channels × 3 msgs (overflow + >16 skipped)', xa.length === 6)
  ok('xair ch1 name', xa[0].address === '/ch/01/config/name' && xa[0].args[0].value === 'Kick')
  ok('xair ch2 phantom on headamp 01', xa[5].address === '/headamp/01/phantom' && xa[5].args[0].value === 1)

  // Yamaha SCP (TCP 49280): ASCII set-lines, 0-indexed channel.
  ok('defaultPort yamaha = 49280', core.defaultPort('yamaha-clql') === 49280)
  const ym = core.messagesFor(ch, { console: 'yamaha-clql' })
  ok('yamaha: 3 lines × 3 channels', ym.length === 9)
  ok('yamaha name line (0-indexed)', ym[0] === 'set MIXER:Current/InCh/Label/Name 0 0 "Kick"\n')
  ok('yamaha colour name', ym[1] === 'set MIXER:Current/InCh/Label/Color 0 0 "Yellow"\n')
  ok('yamaha 48V on', ym[5] === 'set MIXER:Current/InCh/HA/48V 1 0 1\n')

  // Allen & Heath SQ (TCP 51325): one name SysEx per channel, F0…F7.
  ok('defaultPort ah-sq = 51325', core.defaultPort('ah-sq') === 51325)
  const ah = core.messagesFor(ch, { console: 'ah-sq' })
  ok('ah-sq: one frame per non-overflow channel (incl ch17)', ah.length === 3)
  ok('ah-sq frame is SysEx', ah[0][0] === 0xf0 && ah[0][ah[0].length - 1] === 0xf7)
  ok('ah-sq A&H mfr id 00 00 1A', ah[0][1] === 0x00 && ah[0][2] === 0x00 && ah[0][3] === 0x1a)
  ok('ah-sq carries the channel byte + name', ah[0].includes(0x00) && ah[0].includes('K'.charCodeAt(0)))

  ok('unknown console falls back to x32', core.driverFor('nope') === core.driverFor('x32'))
}

// 6. TCP transport delivers frames to a local listener
await new Promise((resolve) => {
  import('./tcp.mjs').then(async ({ sendFrames }) => {
    const net = await import('node:net')
    const got = []
    const server = net.createServer((sock) => {
      sock.on('data', (d) => got.push(d))
    })
    const timer = setTimeout(() => {
      ok('TCP: delivered within timeout', false)
      try {
        server.close()
      } catch {
        /* noop */
      }
      resolve()
    }, 3000)
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address()
      const frames = ['set A 0 0 "x"\n', Buffer.from([0xf0, 0x01, 0xf7])]
      const n = await sendFrames(frames, '127.0.0.1', port, { pace: 1 })
      clearTimeout(timer)
      const all = Buffer.concat(got).toString('binary')
      ok('TCP: sendFrames reports 2 frames', n === 2)
      ok('TCP: ascii frame delivered', all.includes('set A 0 0 "x"'))
      ok('TCP: byte frame delivered (F0…F7)', got.length > 0 && all.includes('\xf0'))
      server.close()
      resolve()
    })
  })
})

console.log(failed ? `\n\x1b[31m${failed} failed\x1b[0m` : '\n\x1b[32mALL PASS\x1b[0m')
process.exit(failed ? 1 : 0)
