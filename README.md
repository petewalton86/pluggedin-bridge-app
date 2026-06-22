# PluggedIn Desk Bridge

A small **desktop app** that preloads a **mixing console** from an event's
**master patch** — the right channel **names, colours, input sources and 48V
phantom**, in order, straight from PluggedIn. Pick your **console** in the app
(it remembers it, and pre-selects from your venue's saved desk).

A browser can't talk to a console (they listen on the local network — OSC/UDP or
TCP), so this app runs on the **FOH laptop**, on the **same network as the desk**,
and speaks the protocol itself. No terminal required.

**Live push:** Behringer **X32 / M32** (confirmed) · Behringer **X-Air / M-Air** ·
Yamaha **CL / QL** (and Rivage/DM) · Allen & Heath **SQ** and **dLive / Avantis**.
Everything except X32/M32 is **beta** — built to each maker's published protocol
but not yet bench-verified, so check names/colours land before doors. Any other
desk: use **Send to desk → Download for my desk** in the web app for a scene /
console-aware CSV / print sheet.

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
3. **Choose the patch** (optional): the **Master patch (all bands)** by default, or a
   single band to load between sets — either on its **master channels** (re-label per
   act) or as a **standalone scene (ch 1–N)**.
4. **Enter the console IP** (Setup → Network on the desk) and click **Push to
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

## Console support

**Live network push (this app)** — pick the console in the app:

| Console | Transport | Port | Status |
| --- | --- | --- | --- |
| Behringer X32 / Midas M32 | OSC / UDP | 10023 | Confirmed |
| Behringer X-Air / Midas M-Air | OSC / UDP | 10024 | Beta |
| Yamaha CL / QL (Rivage PM, DM) | SCP / TCP | 49280 | Beta |
| Allen & Heath SQ | MIDI / TCP | 51325 | Beta |
| Allen & Heath dLive / Avantis | MIDI / TCP | 51325 | Beta |

Beta drivers (`xair.mjs`, `yamaha.mjs`, `ah.mjs`) are built to each maker's
published protocol but **not bench-verified** — confirm names/colours land, and
the per-console command/byte templates are centralised for quick fixes.

**Offline file export (any desk):** in the web app, **Send to desk → Download for my desk** picks
the best artifact for the chosen console — a native **scene** for X32/M32 (and best‑effort
X‑Air), or a **console‑aware CSV** (names pre‑clipped to that desk's scribble‑strip budget) plus a
branded **print patch sheet (PDF)** for everything else. We only ever set **name · colour · input
patch · 48V** — never gains/EQ/mix — so it's safe on any console. Proprietary/binary session files
(Yamaha, Allen & Heath, DiGiCo, PreSonus, Avid) aren't authored; those desks use the CSV / sheet.

## Roadmap
- Bench-verify the beta drivers (X-Air, Yamaha SCP, A&H SysEx) on real hardware.
- Code signing + notarization for warning-free downloads.
- More OSC live push: Behringer/Midas Wing, DiGiCo SD/Quantum.
