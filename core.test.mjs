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

console.log(failed ? `\n\x1b[31m${failed} failed\x1b[0m` : '\n\x1b[32mALL PASS\x1b[0m')
process.exit(failed ? 1 : 0)
