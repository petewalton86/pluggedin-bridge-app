# Building the desktop app

The app is [Electron](https://www.electronjs.org/) packaged with
[electron-builder](https://www.electron.build/). It produces a Windows installer
+ portable `.exe`, a macOS `.dmg`, and a Linux `.AppImage`.

## Prerequisites
- Node.js **20+**.
- `npm install` (downloads Electron + electron-builder — a few hundred MB).

## Run in development
```bash
npm install
npm run dev      # launches the app
npm test         # headless core tests
```

## Build installers
```bash
npm run dist          # installers in dist/
npm run dist:dir      # unpacked app only (faster, for a quick check)
```
Output lands in `dist/`. **Build on the OS you're targeting** — electron-builder
does not cross-compile the macOS `.dmg` from Windows, etc. (CI builds all three on
their native runners — see `.github/workflows/release.yml`).

## App icon
electron-builder derives the platform icons from **`build/icon.png`**. A solid
placeholder is committed; replace it with a square **1024×1024 PNG** (transparent)
of the PluggedIn glyph and rebuild.

## Releases (CI)
Pushing a version tag builds all three platforms and attaches the installers to
the GitHub Release:
```bash
npm version patch        # bumps package.json + creates the tag
git push --follow-tags   # CI builds Windows/macOS/Linux and uploads them
```

## Code signing (TODO)
Builds are **unsigned** today, so download warnings appear. electron-builder signs
from environment variables — add them as repo secrets and the release workflow
picks them up:

- **Windows** — `CSC_LINK` (base64 of a `.pfx`) + `CSC_KEY_PASSWORD`. Or use
  Azure Trusted Signing.
- **macOS** — `CSC_LINK` (base64 of a Developer ID `.p12`) + `CSC_KEY_PASSWORD`,
  then notarize by also setting `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
  `APPLE_TEAM_ID` (electron-builder notarizes automatically when these are set).

Left as a documented placeholder so CI ships working (unsigned) builds until
certificates are available.
