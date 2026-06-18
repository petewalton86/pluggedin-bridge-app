# PluggedIn Desk Bridge

Preload a **Behringer X32 / Midas M32** from an event's **master patch** — the
right channel **names, colours, input sources and 48V phantom**, in order,
straight from PluggedIn.

A browser can't talk to a console (consoles listen on UDP/OSC), so this small
tool runs on the **FOH laptop**, on the **same network as the desk**. It pulls
the resolved channel list from the PluggedIn API and sends OSC to the desk.

## Pairing (no password)

The bridge never uses your account password. Instead you **pair** it once:

1. In PluggedIn, open a master patch → **Send to desk → Connect a desk bridge**.
2. Click **Generate pairing code** — you get a short code like `9A7M-JHZU`.
3. Run the bridge and enter the code when prompted.

The bridge swaps the code for a **scoped, read-only, revocable token** (it can
only read your events' console patches) and remembers it on this device, so you
only pair once. Revoke a device any time from the same dialog.

## Two ways to run it

**A. Single executable (recommended for engineers).** A double-clickable
`PluggedInBridge.exe` (Windows) / `PluggedInBridge` (macOS, Linux) — no Node
install needed. Grab the latest from
[**Releases**](https://github.com/petewalton86/pluggedin-bridge-app/releases),
or build it yourself with **[BUILD.md](BUILD.md)**. Double-click and follow the
prompts.

> Release binaries are currently **unsigned**, so Windows SmartScreen / macOS
> Gatekeeper may warn on first launch (right-click → Open on macOS). Signing is a
> documented TODO in [BUILD.md](BUILD.md) and the release workflow.

**B. With Node** (developers / quick use). Node 18+; no dependencies:
```bash
node bridge.mjs            # prompts: pair (first run), pick an event, desk IP
```

Run with **no options** and it pairs (first time), lists your events to pick
from, and asks for the desk IP. No event id to hunt down.

## Preview / offline use
```bash
# preview without a desk
node bridge.mjs --dry-run

# fully offline: in the web app, Send to desk → Patch data (.json), then
node bridge.mjs --in master-patch-myevent.json --desk 192.168.0.10
```

## Options (flags, env vars, or interactive prompts)
| Flag | Env | Default | Notes |
|---|---|---|---|
| `--event` | `PI_EVENT` | — | Event id (skip the picker) |
| `--desk` | `PI_DESK` | — | Console IP (omit + `--dry-run` to preview) |
| `--port` | `PI_DESK_PORT` | `10023` | X32/M32 OSC port (X‑Air uses `10024`) |
| `--api` | `PI_API` | `http://localhost:4000` | PluggedIn API base URL |
| `--code` | `PI_CODE` | — | Pair non-interactively with this code |
| `--token` | `PI_TOKEN` | — | Use a bridge token directly (skip pairing/storage) |
| `--label` | `PI_LABEL` | hostname | How this device appears in PluggedIn |
| `--reset` | — | — | Forget the saved token and re-pair |
| `--in` | `PI_IN` | — | Exported patch `.json`, instead of the API |
| `--pace` | — | `25` | ms between OSC messages |
| `--dry-run` | — | off | Print the OSC messages instead of sending |
| `-h, --help` | — | — | Show help |

The saved token lives in `~/.pluggedin-bridge.json` (keyed by API URL, file mode
`600`). Delete it or use `--reset` to forget a device locally; revoke it in
PluggedIn to kill it server-side.

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

## Develop / test
```bash
node bridge.test.mjs   # OSC encoder + X32 mapping + a local UDP round-trip
npm run package        # build the single-file executable (see BUILD.md)
```

## Roadmap
- Verify the OSC parameter set against an X32/M32 (and X‑Air) on the bench.
- Additional OSC desks (Behringer/Midas Wing, DiGiCo SD/Quantum).
