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
    const { data } = await ocrWorker.recognize(bild, {}, { text: true, blocks: true });
    // Besides the text, every line with its position and height: the sender's name is usually the largest writing at
    // the top (electron/belege.cjs: stellerErkennen).
    const zeilen = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) {
      const t = (l.text ?? '').trim();
      if (t) zeilen.push({ text: t, y: l.bbox.y0, hoehe: l.bbox.y1 - l.bbox.y0, links: l.bbox.x0 });
    }
    return { text: data.text ?? '', zeilen };
  }

  // Reads one stored document: returns its text, page count and whether OCR was needed.
  async function lesen(datei) {
    const ext = path.extname(datei).toLowerCase();
    const voll = path.join(dokumentOrdner(), datei);
    if (ext === '.pdf') {
      const r = await pdfLesen(fs.readFileSync(voll));
      let ocrNoetig = false;
      let layout = null;
      const seiten = [];
      for (const s of r.seiten) {
        // Pages without a text layer are scans: their rendering is recognised and kept as a preview for Claude.
        if (s.bild) {
          ocrNoetig = true;
          const png = s.bild;
          fs.mkdirSync(vorschauOrdner(), { recursive: true });
          fs.writeFileSync(path.join(vorschauOrdner(), `${path.parse(datei).name}-${s.nr}.png`), png);
          const o = await ocr(png);
          if (!seiten.length) layout = o.zeilen;
          seiten.push(o.text);
        } else seiten.push(s.text);
      }
      // An embedded e-invoice gives the exact invoice data.
      const e = r.xml ? erechnung.lesen(r.xml) : null;
      return { text: seiten.join('\n\f\n') + (e ? `\n\f\n${erechnung.alsText(e)}` : ''), seiten: r.seiten.length, ocr: ocrNoetig, erechnung: e, layout };
    }
    if (BILDER.has(ext)) { const o = await ocr(fs.readFileSync(voll)); return { text: o.text, seiten: 1, ocr: true, layout: o.zeilen }; }
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
            db.analyseSpeichern(d.id, r.text, r.seiten, r.ocr, r.erechnung ?? null, r.layout ?? null);
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
  function importieren(pfade, { objekt_id = null, einheit_id = null, projekt_id = null, person_id = null, buchung_id = null, vorgang_id = null, typ = null, quelle = 'upload', status = 'postfach' } = {}) {
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
      const r = db.dokumentNeu({ objekt_id, einheit_id, projekt_id, person_id, buchung_id, vorgang_id, typ, titel: name.replace(/\.[^.]+$/, ''), datei, name, groesse: daten.length, sha256, quelle, status });
      if (!r.doppelt) fs.writeFileSync(path.join(dokumentOrdner(), datei), daten);
      out.push({ ...r, name });
    }
    setImmediate(warteschlange);
    return out;
  }

  // Digits of a meter photo: the lines with their height (the counter is the largest), read on a black-and-white copy
  // twice – as one block and as sparse text – by a worker that only knows digits.
  let ziffernWorker = null;
  async function ziffernLesen(bild) {
    if (!ziffernWorker) {
      const { createWorker } = require('tesseract.js');
      ziffernWorker = await createWorker(['eng'], 1, { langPath: tessdata, gzip: false, cachePath: cacheOrdner,
        workerPath: ausserhalbAsar(require.resolve('tesseract.js/src/worker-script/node/index.js')) });
    }
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const img = await loadImage(bild);
    // Large phone photos are scaled down to 1600 px: faster and no worse for digits.
    const f = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = createCanvas(Math.round(img.width * f), Math.round(img.height * f));
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11 > 128 ? 255 : 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
    const sw = c.toBuffer('image/png');
    const zeilen = [];
    for (const psm of ['6', '11']) {
      await ziffernWorker.setParameters({ tessedit_char_whitelist: '0123456789,.', tessedit_pageseg_mode: psm });
      const { data } = await ziffernWorker.recognize(sw, {}, { text: true, blocks: true });
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) zeilen.push({ text: l.text.trim(), hoehe: l.bbox.y1 - l.bbox.y0 });
    }
    return zeilen;
  }

  return {
    importieren,
    warteschlange,
    ziffernLesen,
    neuAnalysieren: (id) => {
      db.analyseZuruecksetzen(id);
      setImmediate(warteschlange);
    },
    beenden: async () => {
      if (ocrWorker) await ocrWorker.terminate();
      if (ziffernWorker) await ziffernWorker.terminate();
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
