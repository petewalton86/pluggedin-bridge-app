// Minimal, safe bridge between the sandboxed renderer and the main process.
// Exposes only these calls on window.bridge; no Node APIs reach the page.
const { contextBridge, ipcRenderer } = require('electron')

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld('bridge', {
  state: (api) => invoke('state', api),
  pair: (api, code, label) => invoke('pair', api, code, label),
  forget: (api) => invoke('forget', api),
  events: (api) => invoke('events', api),
  patch: (api, eventId, opts) => invoke('patch', api, eventId, opts),
  preview: (channels, opts) => invoke('preview', channels, opts),
  push: (channels, opts) => invoke('push', channels, opts),
  patchFile: () => invoke('patch-file'),
  exportAhCsv: (channels, suggestedName) => invoke('export-ah-csv', channels, suggestedName),
  openExternal: (url) => invoke('open-external', url),
})
