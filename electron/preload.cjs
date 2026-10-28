const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('hv', {
  plattform: process.platform,
  // Text size: zooms the whole window like ⌘+ / ⌘−.
  zoom: (faktor) => webFrame.setZoomFactor(faktor),
  call: (fn, ...args) => ipcRenderer.invoke('db', fn, args),
  pdf: (html, name) => ipcRenderer.invoke('pdf', html, name),
  steuerpaket: (objektId, jahr, html) => ipcRenderer.invoke('steuerpaket', objektId, jahr, html),
  pdfAblegen: (html, name, meta) => ipcRenderer.invoke('pdfAblegen', html, name, meta),
  speichern: (inhalt, name, filter) => ipcRenderer.invoke('speichern', inhalt, name, filter),
  oeffnen: (filter) => ipcRenderer.invoke('oeffnen', filter),
  sicherung: () => ipcRenderer.invoke('sicherung'),
  wiederherstellen: () => ipcRenderer.invoke('wiederherstellen'),
  sicherungsOrdnerOeffnen: () => ipcRenderer.invoke('sicherungsOrdnerOeffnen'),
  dokumentAblegen: () => ipcRenderer.invoke('dokumentAblegen'),
  dokumentOeffnen: (datei) => ipcRenderer.invoke('dokumentOeffnen', datei),
  dokumentLoeschen: (id) => ipcRenderer.invoke('dokumentLoeschen', id),
  // Dropped files: the real path is only available here in the preload.
  importieren: (files, opt) => ipcRenderer.invoke('importieren', [...files].map((f) => webUtils.getPathForFile(f)).filter(Boolean), opt),
  dateienImportieren: (opt) => ipcRenderer.invoke('dateienImportieren', opt),
  neuAnalysieren: (id) => ipcRenderer.invoke('neuAnalysieren', id),
  bei: (kanal, fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on(kanal, h);
    return () => ipcRenderer.removeListener(kanal, h);
  },
  extern: (url) => ipcRenderer.invoke('extern', url),
  info: () => ipcRenderer.invoke('info'),
  claudeStatus: () => ipcRenderer.invoke('claudeStatus'),
  eingangsordnerWaehlen: () => ipcRenderer.invoke('eingangsordnerWaehlen'),
  eingangsordnerAus: () => ipcRenderer.invoke('eingangsordnerAus'),
  mailSpeichern: (cfg, pw) => ipcRenderer.invoke('mailSpeichern', cfg, pw),
  mailTesten: () => ipcRenderer.invoke('mailTesten'),
  mailAbrufen: () => ipcRenderer.invoke('mailAbrufen'),
  claudeVerbinden: () => ipcRenderer.invoke('claudeVerbinden'),
  // Native context menu: entries { id, label, enabled } or '-'; resolves with the chosen id or null.
  kontextmenue: (eintraege) => ipcRenderer.invoke('kontextmenue', eintraege),
});
