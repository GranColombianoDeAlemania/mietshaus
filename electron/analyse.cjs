// File intake and text recognition for the document archive.
// PDFs are read (and rendered when scanned) in a hidden window with pdf.js; images and scanned pages go through Tesseract OCR.
const { app, BrowserWindow, protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const erechnung = require('./erechnung.cjs');

const BILDER = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp', '.gif']);
const TEXT = new Set(['.txt', '.csv', '.md', '.xml', '.json', '.eml', '.html', '.htm']);

// hvdok://dokument/<file> and hvdok://vorschau/<file>. CORS is allowed because pages load from http:// (dev) or file://.
function protokollRegistrieren(dokumentOrdner, vorschauOrdner) {
  protocol.handle('hvdok', async (req) => {
    const u = new URL(req.url);
    const ordner = u.hostname === 'vorschau' ? vorschauOrdner() : dokumentOrdner();
    const r = await net.fetch(pathToFileURL(path.join(ordner, path.basename(decodeURIComponent(u.pathname)))).href);
    const headers = new Headers(r.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(r.body, { status: r.status, headers });
  });
}

module.exports = function analyse({ db, dokumentOrdner, vorschauOrdner, analyseUrl, onFertig }) {
  let fenster = null;
  let ocrWorker = null;
  let laeuft = false;

  // Files inside the packaged app archive cannot be loaded by worker threads, so they are read from the unpacked copy.
  const ausserhalbAsar = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  const tessdata = () => (app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : path.join(__dirname, '..', 'resources', 'tessdata'));

  async function ocr(bild) {
    if (!ocrWorker) {
      const { createWorker } = require('tesseract.js');
      ocrWorker = await createWorker(['deu', 'eng'], 1, {
        langPath: tessdata(),
        gzip: false,
        cachePath: path.join(app.getPath('userData'), 'ocr-cache'),
        workerPath: ausserhalbAsar(require.resolve('tesseract.js/src/worker-script/node/index.js')),
      });
    }
    const { data } = await ocrWorker.recognize(bild);
    return data.text ?? '';
  }

  async function analyseFenster() {
    if (fenster && !fenster.isDestroyed()) return fenster;
    fenster = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    await fenster.loadURL(analyseUrl());
    return fenster;
  }

  // Reads one stored document: returns its text, page count and whether OCR was needed.
  async function lesen(datei) {
    const ext = path.extname(datei).toLowerCase();
    const voll = path.join(dokumentOrdner(), datei);
    if (ext === '.pdf') {
      const w = await analyseFenster();
      const r = await w.webContents.executeJavaScript(`window.pdfLesen(${JSON.stringify(`hvdok://dokument/${encodeURIComponent(datei)}`)})`);
      let ocrNoetig = false;
      const seiten = [];
      for (const s of r.seiten) {
        // Pages without a text layer are scans: their rendering is recognised and kept as a preview for Claude.
        if (s.bild) {
          ocrNoetig = true;
          const png = Buffer.from(s.bild.split(',')[1], 'base64');
          fs.mkdirSync(vorschauOrdner(), { recursive: true });
          fs.writeFileSync(path.join(vorschauOrdner(), `${path.parse(datei).name}-${s.nr}.png`), png);
          seiten.push(await ocr(png));
        } else seiten.push(s.text);
      }
      // An embedded e-invoice gives the exact invoice data.
      const e = r.xml ? erechnung.lesen(r.xml) : null;
      return { text: seiten.join('\n\f\n') + (e ? `\n\f\n${erechnung.alsText(e)}` : ''), seiten: r.seiten.length, ocr: ocrNoetig, erechnung: e };
    }
    if (BILDER.has(ext)) return { text: await ocr(fs.readFileSync(voll)), seiten: 1, ocr: true };
    if (ext === '.xml') {
      const xml = fs.readFileSync(voll, 'utf8');
      const e = erechnung.lesen(xml);
      if (e) return { text: erechnung.alsText(e), seiten: 1, ocr: false, erechnung: e };
    }
    if (TEXT.has(ext)) return { text: fs.readFileSync(voll, 'utf8').slice(0, 2_000_000), seiten: 1, ocr: false };
    return { text: '', seiten: null, ocr: false };
  }

  // Works through all documents waiting for analysis, one at a time in the background.
  async function warteschlange() {
    if (laeuft) return;
    laeuft = true;
    try {
      for (;;) {
        const offen = db.zuAnalysieren();
        if (!offen.length) break;
        for (const d of offen) {
          try {
            const r = await lesen(d.datei);
            db.analyseSpeichern(d.id, r.text, r.seiten, r.ocr, r.erechnung ?? null);
          } catch (e) {
            db.analyseFehler(d.id, String(e?.message ?? e));
          }
          onFertig?.(d.id);
        }
      }
    } finally {
      laeuft = false;
    }
  }

  // Copies files into the archive; identical files (same SHA-256) are only stored once.
  function importieren(pfade, { objekt_id = null, einheit_id = null, projekt_id = null, person_id = null, buchung_id = null, typ = null, quelle = 'upload', status = 'postfach' } = {}) {
    fs.mkdirSync(dokumentOrdner(), { recursive: true });
    const out = [];
    for (const p of pfade) {
      let daten = fs.readFileSync(p);
      const sha256 = crypto.createHash('sha256').update(daten).digest('hex');
      let ext = path.extname(p).toLowerCase();
      // iPhone photos (HEIC) cannot be shown or read by the app; macOS converts them to JPEG with its built-in sips tool.
      if ((ext === '.heic' || ext === '.heif') && process.platform === 'darwin') {
        const tmp = path.join(app.getPath('temp'), `${crypto.randomUUID()}.jpg`);
        try {
          require('node:child_process').execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', p, '--out', tmp], { stdio: 'ignore' });
          daten = fs.readFileSync(tmp);
          ext = '.jpg';
        } catch {} finally { fs.rmSync(tmp, { force: true }); }
      }
      const datei = `${crypto.randomUUID()}${ext}`;
      const name = path.basename(p);
      const r = db.dokumentNeu({ objekt_id, einheit_id, projekt_id, person_id, buchung_id, typ, titel: name.replace(/\.[^.]+$/, ''), datei, name, groesse: daten.length, sha256, quelle, status });
      if (!r.doppelt) fs.writeFileSync(path.join(dokumentOrdner(), datei), daten);
      out.push({ ...r, name });
    }
    setImmediate(warteschlange);
    return out;
  }

  return {
    importieren,
    warteschlange,
    neuAnalysieren: (id) => {
      db.analyseZuruecksetzen(id);
      setImmediate(warteschlange);
    },
    beenden: async () => {
      if (ocrWorker) await ocrWorker.terminate();
      if (fenster && !fenster.isDestroyed()) fenster.destroy();
    },
  };
};

module.exports.protokollRegistrieren = protokollRegistrieren;
module.exports.SCHEMA = { scheme: 'hvdok', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } };
