// Computes the text vectors of the image-search vocabulary (woerter.txt) with the text half of the same CLIP model whose
// image half runs in the app, and writes electron/bildwoerter.json. Only needed after changing the vocabulary; the app
// itself never needs the text model. Run with @huggingface/transformers installed in some folder:
//   node scripts/bildsuche/woerter.mjs <folder with node_modules/@huggingface/transformers>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELL = 'Xenova/clip-vit-base-patch32';
const REVISION = '6b7c523703ae26e39be4b03774966f8571c7f523';
const hier = path.dirname(fileURLToPath(import.meta.url));
const rq = createRequire(path.join(process.argv[2], 'package.json'));
const m = await import(rq.resolve('@huggingface/transformers'));
const T = m.default?.env ? m.default : m;
T.env.cacheDir = path.join(process.argv[2], 'hfcache');
const zeilen = fs.readFileSync(path.join(hier, 'woerter.txt'), 'utf8').split('\n').map((z) => z.trim()).filter((z) => z && !z.startsWith('#'))
  .map((z) => z.split('|').map((x) => x.trim()));
const tok = await T.AutoTokenizer.from_pretrained(MODELL, { revision: REVISION });
const tm = await T.CLIPTextModelWithProjection.from_pretrained(MODELL, { revision: REVISION, dtype: 'q8' });
const { text_embeds } = await tm(tok(zeilen.map(([, en]) => `a photo of ${en}`), { padding: true, truncation: true }));
const d = text_embeds.dims[1];
// Unit vectors stored as signed bytes (× 127): small, and precise enough for comparing.
const woerter = zeilen.map(([de, en], i) => {
  const v = Array.from(text_embeds.data.slice(i * d, (i + 1) * d));
  const n = Math.hypot(...v);
  return [de, en, Buffer.from(Int8Array.from(v.map((x) => Math.round((x / n) * 127))).buffer).toString('base64')];
});
fs.writeFileSync(path.join(hier, '../../electron/bildwoerter.json'), JSON.stringify({ modell: `${MODELL}@${REVISION}`, woerter }, null, 0) + '\n');
console.log(woerter.length, 'Wörter');
