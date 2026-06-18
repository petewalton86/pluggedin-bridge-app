# PluggedIn Desk Bridge

A small **desktop app** that preloads a **Behringer X32 / Midas M32** from an
event's **master patch** — the right channel **names, colours, input sources and
48V phantom**, in order, straight from PluggedIn.

A browser can't talk to a console (consoles listen on UDP/OSC), so this app runs
on the **FOH laptop**, on the **same network as the desk**, and sends the OSC
itself. No terminal required.

![PluggedIn](renderer/assets/pluggedin-logo-light.svg)

## Install

Download the latest build for your OS from
[**Releases**](https://github.com/petewalton86/pluggedin-bridge-app/releases):

- **Windows** — `PluggedIn Desk Bridge Setup x.y.z.exe` (installer) or the
  portable `.exe`.
- **macOS** — the `.dmg` (drag to Applications).
- **Linux** — the `.AppImage` (mark executable and run).

> Builds are currently **unsigned**, so Windows SmartScreen / macOS Gatekeeper
> warn on first launch (Windows: More info → Run anyway; macOS: right-click →
> Open). Signing is a documented TODO — see [BUILD.md](BUILD.md).

## Use it

1. **Pair once.** In PluggedIn, open a master patch → **Send to desk → Connect a
   desk bridge** and generate a code. Launch the app, paste the code, click
   **Pair this device**. It swaps the code for a **scoped, read-only, revocable**
   token (it can only read your events' console patches — never your password)
   and remembers this device. Revoke it any time from the same dialog.
2. **Pick the event** from the dropdown.
3. **Enter the console IP** (Setup → Network on the desk) and click **Push to
   desk**. Use **Preview** to see the channel list / OSC without sending.

**Offline?** In the web app use **Send to desk → Patch data (.json)**, copy the
file to the laptop, and use **Load a patch file…** in the app — no network/API
needed.

## What it sets
Per console channel, in master‑patch order (bounded by the venue's desk size):
- **name** (`/ch/NN/config/name`) — clipped to the 12‑char scribble strip
- **colour** (`/ch/NN/config/color`) — by instrument type
- **input source** (`/ch/NN/config/source`) — local input N
- **48V phantom** (`/headamp/NNN/phantom`) — on if any band on that channel needs it

It does **not** set gains/EQ/dynamics/routing (PluggedIn doesn't hold those).

> **Tip:** push **before** dialling the mix, or use the console's **recall scope**
> (Config/Preamp) so it only writes names, colours and 48V and leaves your work
> intact.

## Develop
```bash
npm install
npm run dev      # launch the Electron app
npm test         # headless core tests (OSC + X32 mapping + UDP + token store)
```
Build installers: see [BUILD.md](BUILD.md). Architecture: the Electron **main
process** (`electron/main.cjs`) runs all logic via `core.mjs` (pairing, fetch,
OSC over UDP); the sandboxed renderer (`renderer/`) talks to it only through the
`preload.cjs` bridge.

## Roadmap
- Verify the OSC parameter set against an X32/M32 (and X‑Air) on the bench.
- Code signing + notarization for warning-free downloads.
- Additional OSC desks (Behringer/Midas Wing, DiGiCo SD/Quantum).
