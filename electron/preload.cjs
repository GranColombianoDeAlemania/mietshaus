// The Mac app's additions to the user interface (window.hvDesktop, used by src/bruecke.ts). Everything else, all data
// included, goes over HTTP to the Mietshaus server – embedded on this Mac or on the NAS.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

const start = ipcRenderer.sendSync('hv:start');
const rufe = (name) => (...args) => ipcRenderer.invoke(`hv:${name}`, ...args);

contextBridge.exposeInMainWorld('hvDesktop', {
  plattform: start.plattform,
  geraet: start.geraet,
  lokal: start.lokal,
  version: start.version,
  schnittstelle: start.schnittstelle,
  updateStatus: rufe('updateStatus'),
  updateInstallieren: rufe('updateInstallieren'),
  // Text size: zooms the whole window like ⌘+ / ⌘−.
  zoom: (faktor) => webFrame.setZoomFactor(faktor),
  pdfBytes: rufe('pdfBytes'),
  speichern: rufe('speichern'),
  dateiOeffnen: rufe('dateiOeffnen'),
  extern: rufe('extern'),
  // Native context menu: entries { id, label, enabled } or '-'; resolves with the chosen id or null.
  kontextmenue: rufe('kontextmenue'),
  ordnerWaehlen: rufe('ordnerWaehlen'),
  ordnerZeigen: rufe('ordnerZeigen'),
  claudeStatus: rufe('claudeStatus'),
  claudeVerbinden: rufe('claudeVerbinden'),
  verbindung: rufe('verbindung'),
  verbindungSetzen: rufe('verbindungSetzen'),
  datenUebertragen: rufe('datenUebertragen'),
  paketErstellen: rufe('paketErstellen'),
  bei: (kanal, fn) => {
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on(`hv:${kanal}`, h);
    return () => ipcRenderer.removeListener(`hv:${kanal}`, h);
  },
});
