const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hv', {
  call: (fn, ...args) => ipcRenderer.invoke('db', fn, args),
  pdf: (html, name) => ipcRenderer.invoke('pdf', html, name),
  speichern: (inhalt, name, filter) => ipcRenderer.invoke('speichern', inhalt, name, filter),
  oeffnen: (filter) => ipcRenderer.invoke('oeffnen', filter),
  sicherung: () => ipcRenderer.invoke('sicherung'),
  wiederherstellen: () => ipcRenderer.invoke('wiederherstellen'),
  dokumentAblegen: () => ipcRenderer.invoke('dokumentAblegen'),
  dokumentOeffnen: (datei) => ipcRenderer.invoke('dokumentOeffnen', datei),
  dokumentLoeschen: (datei) => ipcRenderer.invoke('dokumentLoeschen', datei),
  extern: (url) => ipcRenderer.invoke('extern', url),
  info: () => ipcRenderer.invoke('info'),
});
