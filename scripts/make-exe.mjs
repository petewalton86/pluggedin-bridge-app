// Turn the SEA blob into a single-file executable for the current OS.
// Run via `npm run package` (which bundles + builds the blob first).
import { createRequire } from 'node:module'
import { copyFileSync, readFileSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { platform } from 'node:process'

const require = createRequire(import.meta.url)
const { inject } = require('postject')

const isWin = platform === 'win32'
const isMac = platform === 'darwin'
const out = isWin ? 'PluggedInBridge.exe' : 'PluggedInBridge'
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

// Start from a copy of the running Node binary.
copyFileSync(process.execPath, out)

// macOS won't run a tampered signed binary — strip the signature first.
if (isMac) {
  try {
    execFileSync('codesign', ['--remove-signature', out])
  } catch {
    /* unsigned already */
  }
}

await inject(out, 'NODE_SEA_BLOB', readFileSync('sea-prep.blob'), {
  sentinelFuse: FUSE,
  ...(isMac ? { machoSegmentName: 'NODE_SEA' } : {}),
})

if (!isWin) chmodSync(out, 0o755)

// Re-sign on macOS so Gatekeeper will launch it (ad-hoc signature).
if (isMac) {
  try {
    execFileSync('codesign', ['--sign', '-', out])
  } catch {
    /* signing optional */
  }
}

console.log(`\n✓ Built ${out} — hand this single file to the engineer.`)
