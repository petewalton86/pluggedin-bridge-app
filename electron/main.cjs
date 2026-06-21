// Electron main process for the PluggedIn Desk Bridge. Owns the window and runs
// all bridge logic (pairing, fetch, OSC over UDP) by importing the ESM core.
// The renderer is sandboxed and talks to us only through the preload bridge.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

let corePromise
const getCore = () => {
  if (!corePromise)
    corePromise = import(pathToFileURL(path.join(__dirname, '..', 'core.mjs')).href)
  return corePromise
}

// Wrap an async handler so the renderer always gets { ok, data } / { ok:false,
// error, code } instead of an unhandled IPC rejection.
const handle = (channel, fn) =>
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(await getCore(), ...args) }
    } catch (e) {
      return { ok: false, error: e?.message || String(e), code: e?.code || null }
    }
  })

function createWindow() {
  const win = new BrowserWindow({
    width: 540,
    height: 740,
    minWidth: 460,
    minHeight: 560,
    backgroundColor: '#0b1220',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.removeMenu()
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    handle('state', (core, api) => core.getState(api))
    handle('pair', (core, api, code, label) => core.pair(api, code, label))
    handle('forget', (core, api) => core.clearToken(api))
    handle('events', (core, api) => core.listEvents(api))
    handle('patch', (core, api, eventId) => core.loadPatch(api, eventId))
    handle('preview', (core, channels, opts) => core.messagesFor(channels, opts))
    handle('push', (core, channels, opts) => core.push(channels, opts))
    handle('patch-file', async (core) => {
      const r = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Patch JSON', extensions: ['json'] }],
      })
      if (r.canceled || !r.filePaths[0]) return null
      return core.loadPatchFile(r.filePaths[0])
    })
    handle('open-external', async (_core, url) => {
      if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
      return true
    })

    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
