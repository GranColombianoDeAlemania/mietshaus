const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hv', {
  call: (fn, ...args) => ipcRenderer.invoke('db', fn, args),
});
