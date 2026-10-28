// File intake and text recognition for the document archive, in plain Node (Mac app and server alike).
// PDFs are read with pdf.js (pdf.cjs, scans rendered as images); images and scanned pages go through Tesseract OCR.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const erechnung = require('./erechnung.cjs');
const { pdfLesen } = require('./pdf.cjs');

const BILDER = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp', '.gif']);
const TEXT = new Set(['.txt', '.csv', '.md', '.xml', '.json', '.eml', '.html', '.htm']);

// tessdata: folder with the Tesseract language files (resources/tessdata); cacheOrdner: Tesseract's cache.
module.exports = function analyse({ db, dokumentOrdner, vorschauOrdner, onFertig, tessdata = path.join(__dirname, '..', 'resources', 'tessdata'),
  cacheOrdner = path.join(os.tmpdir(), 'mietshaus-ocr') }) {
  let ocrWorker = null;
  let laeuft = false;

  // Files inside the packaged app archive cannot be loaded by worker threads, so they are read from the unpacked copy.
  const ausserhalbAsar = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

  async function ocr(bild) {
    if (!ocrWorker) {
      const { createWorker } = require('tesseract.js');
      ocrWorker = await createWorker(['deu', 'eng'], 1, {
        langPath: tessdata,
        gzip: false,
        cachePath: cacheOrdner,
        workerPath: ausserhalbAsar(require.resolve('tesseract.js/src/worker-script/node/index.js')),
      });
    }
    const { data } = await ocrWorker.recognize(bild);
    return data.text ?? '';
  }

  // Reads one stored document: returns its text, page count and whether OCR was needed.
  async function lesen(datei) {
    const ext = path.extname(datei).toLowerCase();
    const voll = path.join(dokumentOrdner(), datei);
    if (ext === '.pdf') {
      const r = await pdfLesen(fs.readFileSync(voll));
      let ocrNoetig = false;
      const seiten = [];
      for (const s of r.seiten) {
        // Pages without a text layer are scans: their rendering is recognised and kept as a preview for Claude.
        if (s.bild) {
          ocrNoetig = true;
          const png = s.bild;
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
      // iPhone photos (HEIC) cannot be shown or read by the app: they become JPEG (macOS: built-in sips; elsewhere heic-convert).
      if (ext === '.heic' || ext === '.heif') {
        const jpeg = heicZuJpeg(p, daten);
        if (jpeg) { daten = jpeg; ext = '.jpg'; }
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
    },
  };
};

// HEIC/HEIF → JPEG, or null when it cannot be converted (the file is then kept as it is).
function heicZuJpeg(datei, daten) {
  if (process.platform === 'darwin') {
    const tmp = path.join(os.tmpdir(), `${crypto.randomUUID()}.jpg`);
    try {
      require('node:child_process').execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', datei, '--out', tmp], { stdio: 'ignore' });
      return fs.readFileSync(tmp);
    } catch { return null; } finally { fs.rmSync(tmp, { force: true }); }
  }
  try {
    // heic-convert works in pure JavaScript but returns a promise; run it in a child process to keep importieren synchronous.
    const skript = `require(${JSON.stringify(require.resolve('heic-convert'))})({ buffer: require('fs').readFileSync(process.argv[1]), format: 'JPEG', quality: 0.9 })
      .then((b) => process.stdout.write(Buffer.from(b)))`;
    return require('node:child_process').execFileSync(process.execPath, ['-e', skript, datei], { maxBuffer: 200 * 1024 * 1024, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  } catch { return null; }
}
