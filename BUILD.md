# Building the single-file executable

This produces one self-contained binary (`PluggedInBridge.exe` on Windows,
`PluggedInBridge` on macOS/Linux) that an engineer can **double-click** — no
Node install, no copying files. It bundles the bridge with
[esbuild](https://esbuild.github.io/) and wraps it as a
[Node Single Executable Application](https://nodejs.org/api/single-executable-applications.html).

## Prerequisites (on the build machine only)
- Node.js **20+** (the SEA tooling ships with Node).
- `npm install` once, to fetch the two dev tools (`esbuild`, `postject`).

## Build
```bash
cd bridge
npm install
npm run package
```
That runs three steps (also available individually):
1. `npm run bundle` → `dist/bridge.cjs` (one file, esbuild).
2. `npm run blob`   → `sea-prep.blob` (Node SEA config).
3. `node scripts/make-exe.mjs` → copies the Node binary and injects the blob.

The binary is written to `bridge/PluggedInBridge[.exe]`.

> Build on the **same OS** you're targeting — SEA binaries are not
> cross-platform. Build the `.exe` on Windows, the mac binary on macOS, etc.
> On macOS the script ad-hoc re-signs the binary so Gatekeeper will launch it.

## Run it
Double-click, or from a terminal:
```bash
./PluggedInBridge            # prompts for sign-in, event, desk IP
./PluggedInBridge --help     # all flags
./PluggedInBridge --in master-patch-myevent.json --dry-run   # offline preview
```

## How the engineer uses it
1. Connect the FOH laptop to the **same network as the desk**.
2. Double-click `PluggedInBridge`.
3. Sign in, paste the **event id**, enter the **console IP** (Setup → Network).
4. It lists the channels and pushes names / colours / 48V to the desk.

For air-gapped FOH: in the web app use **Send to desk → Patch data (.json)**,
copy that file to the laptop, and run `PluggedInBridge --in <file>.json --desk <ip>`.
No API access needed.
