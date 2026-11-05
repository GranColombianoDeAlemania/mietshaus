// Local image search: the image half of a CLIP model (about 90 MB, loaded once when switched on and checked by its
// checksum) runs on this server or Mac; photos never leave it. Each photo is compared with a fixed vocabulary of the
// trade (bildwoerter.json, made by scripts/bildsuche) and gets German keywords – „Heizung“, „Schimmel“, „Dachrinne“ –
// that the archive's full-text search finds like any other word.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MODELL = {
  datei: 'clip-vit-b32-vision-q8.onnx',
  url: 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/6b7c523703ae26e39be4b03774966f8571c7f523/onnx/vision_model_quantized.onnx',
  sha256: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299',
  groesse: 89117001,
};
const MEAN = [0.48145466, 0.4578275, 0.40821073], STD = [0.26862954, 0.26130258, 0.27577711];
const GROESSE = 224;
// The best keyword counts from half this share of the probability over the whole vocabulary, further ones from ZUSATZ
// (fewer false alarms like „Einbruch“ on a photo of keys); at most three per photo.
const SCHWELLE = 0.12, ZUSATZ = 0.2, MAX = 3;

const WOERTER = JSON.parse(fs.readFileSync(path.join(__dirname, 'bildwoerter.json'), 'utf8')).woerter
  .map(([de, , b64]) => [de, Int8Array.from(Buffer.from(b64, 'base64'))]);

// Unit vector ↔ signed bytes (× 127), as the vocabulary is stored.
const alsBytes = (v) => Buffer.from(Int8Array.from(v, (x) => Math.round(x * 127)).buffer).toString('base64');
const ausBytes = (b64) => Float32Array.from(Int8Array.from(Buffer.from(b64, 'base64')), (x) => x / 127);

// Keywords of an image vector: softmax over the vocabulary (CLIP's scale of 100), the best ones above the threshold.
function stichworte(vektor) {
  const sim = WOERTER.map(([, w]) => { let s = 0; for (let i = 0; i < w.length; i++) s += (w[i] / 127) * vektor[i]; return s; });
  const hoch = Math.max(...sim);
  const exp = sim.map((s) => Math.exp(100 * (s - hoch)));
  const summe = exp.reduce((a, x) => a + x, 0);
  return WOERTER.map(([de], i) => [de, exp[i] / summe]).sort((a, b) => b[1] - a[1]).filter(([, p], i) => (i === 0 ? p >= SCHWELLE / 2 : p >= ZUSATZ)).slice(0, MAX).map(([de]) => de);
}

function bildsuche({ ordner }) {
  const pfad = path.join(ordner, MODELL.datei);
  let sitzung = null;
  let laden = null; // running download: { geladen, gesamt, fehler }

  const vorhanden = () => fs.existsSync(pfad);

  // Loads the model once into the data folder: into a temporary file, checked, then renamed – never half a model.
  async function herunterladen() {
    if (vorhanden() || laden?.laeuft) return;
    laden = { laeuft: true, geladen: 0, gesamt: MODELL.groesse, fehler: null };
    const tmp = `${pfad}.laden`;
    try {
      fs.mkdirSync(ordner, { recursive: true });
      const r = await fetch(MODELL.url, { redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`Download fehlgeschlagen (${r.status})`);
      const hash = crypto.createHash('sha256');
      const ziel = fs.createWriteStream(tmp);
      for await (const teil of r.body) {
        hash.update(teil);
        if (!ziel.write(teil)) await new Promise((ok) => ziel.once('drain', ok));
        laden.geladen += teil.length;
      }
      await new Promise((ok, nein) => ziel.end((e) => (e ? nein(e) : ok())));
      if (hash.digest('hex') !== MODELL.sha256) throw new Error('Die geladene Datei stimmt nicht mit der erwarteten Prüfsumme überein.');
      fs.renameSync(tmp, pfad);
      laden = null;
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      laden = { laeuft: false, geladen: 0, gesamt: MODELL.groesse, fehler: String(e?.message ?? e) };
    }
  }

  async function sitzungHolen() {
    if (sitzung) return sitzung;
    const ort = require('onnxruntime-node');
    // Two threads: the photos are tagged in the background, the server stays responsive.
    sitzung = await ort.InferenceSession.create(pfad, { intraOpNumThreads: 2, interOpNumThreads: 1 });
    return sitzung;
  }

  // Image file → unit vector (224 × 224, shortest side scaled, centred, CLIP's normalisation).
  async function vektor(datei) {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const ort = require('onnxruntime-node');
    const img = await loadImage(fs.readFileSync(datei));
    const k = GROESSE / Math.min(img.width, img.height);
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    const c = createCanvas(GROESSE, GROESSE);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, GROESSE, GROESSE);
    g.drawImage(img, (GROESSE - w) / 2, (GROESSE - h) / 2, w, h);
    const px = g.getImageData(0, 0, GROESSE, GROESSE).data;
    const n = GROESSE * GROESSE;
    const daten = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) daten[ch * n + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch];
    const s = await sitzungHolen();
    const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', daten, [1, 3, GROESSE, GROESSE]) });
    const v = Array.from(r[s.outputNames[0]].data);
    const laenge = Math.hypot(...v) || 1;
    return Float32Array.from(v, (x) => x / laenge);
  }

  return {
    vorhanden,
    herunterladen,
    ladestand: () => laden,
    // Keywords and the stored vector of one image file.
    async auswerten(datei) {
      const v = await vektor(datei);
      return { stichworte: stichworte(v), vektor: alsBytes(v) };
    },
    loeschen() { sitzung = null; fs.rmSync(pfad, { force: true }); },
  };
}

module.exports = { bildsuche, stichworte, alsBytes, ausBytes, MODELL, WOERTER };
