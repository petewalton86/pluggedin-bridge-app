# PluggedIn Desk Bridge

Preload a **Behringer X32 / Midas M32** from an event's **master patch** — the
right channel **names, colours, input sources and 48V phantom**, in order,
straight from PluggedIn.

A browser can't talk to a console (consoles listen on UDP/OSC), so this small
tool runs on the **FOH laptop**, on the **same network as the desk**. It pulls
the resolved channel list from the PluggedIn API (or an exported file) and
sends OSC to the desk.

## Two ways to run it

**A. Single executable (recommended for engineers).** Build a double-clickable
`PluggedInBridge.exe` / `PluggedInBridge` — no Node install needed on the FOH
laptop. See **[BUILD.md](BUILD.md)**. Double-click it and answer the prompts.

**B. With Node** (for developers / quick use). Node 18+; no dependencies:
```bash
node bridge.mjs                     # prompts for everything
node bridge.mjs --event <id> --desk 192.168.0.10 \
  --email you@example.com --password '••••••'
```

Run with **no options** and it prompts for sign-in, event id and desk IP.

## Preview / offline use
```bash
# preview without a desk
node bridge.mjs --event <id> --dry-run --email you@x --password '••••'

# fully offline: in the web app, Send to desk → Patch data (.json), then
node bridge.mjs --in master-patch-myevent.json --desk 192.168.0.10
```

## Options (flags, env vars, or interactive prompts)
| Flag | Env | Default | Notes |
|---|---|---|---|
| `--event` | `PI_EVENT` | — | The event id |
| `--desk` | `PI_DESK` | — | Console IP (omit + `--dry-run` to preview) |
| `--port` | `PI_DESK_PORT` | `10023` | X32/M32 OSC port (X‑Air uses `10024`) |
| `--api` | `PI_API` | `http://localhost:4000` | PluggedIn API base URL |
| `--token` | `PI_TOKEN` | — | Session token, instead of email/password |
| `--email` / `--password` | `PI_EMAIL` / `PI_PASSWORD` | — | Sign in |
| `--in` | `PI_IN` | — | Exported patch `.json`, instead of the API |
| `--pace` | — | `25` | ms between OSC messages |
| `--dry-run` | — | off | Print the OSC messages instead of sending |
| `-h, --help` | — | — | Show help |

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
- Pairing‑code sign‑in so credentials are never typed at FOH.
- Additional OSC desks (Behringer/Midas Wing, DiGiCo SD/Quantum).
