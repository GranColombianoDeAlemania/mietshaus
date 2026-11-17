// Photos of paper become scan-like pages, in the browser: the sheet is found against its background, its corners are
// pulled straight (perspective), the colours are evened out (white paper, dark writing). Several pages then become one
// PDF (see pdfbau.ts). Everything runs on the device; nothing is sent until the finished PDF is uploaded.

export type Punkt = { x: number; y: number };
export type Filter = 'farbe' | 'grau' | 'original';

const leinwand = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

// An image file as a drawable bitmap, turned upright by its EXIF orientation. Files the browser cannot decode (HEIC
// outside Safari) are converted by the server first.
export async function bildLaden(f: Blob, umwandeln?: (f: Blob) => Promise<Blob>): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(f, { imageOrientation: 'from-image' });
  } catch (e) {
    if (!umwandeln) throw e;
    return createImageBitmap(await umwandeln(f), { imageOrientation: 'from-image' });
  }
}

// Otsu: the brightness threshold that best separates two groups (paper and background).
function otsu(hist: number[], n: number) {
  let summe = 0;
  for (let i = 0; i < 256; i++) summe += i * hist[i];
  let sB = 0, wB = 0, best = 0, schwelle = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (summe - sB) / wF;
    const zwischen = wB * wF * (mB - mF) ** 2;
    if (zwischen > best) { best = zwischen; schwelle = t; }
  }
  return schwelle;
}

const flaeche = (p: Punkt[]) => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;

// The four corners of the sheet (top left, top right, bottom right, bottom left) in pixels of the image, or null when no
// clear sheet stands out (a scan that fills the picture, white paper on a white table, a photo of something else).
export function eckenFinden(bild: CanvasImageSource & { width: number; height: number }): Punkt[] | null {
  const s = Math.min(1, 360 / Math.max(bild.width, bild.height));
  const w = Math.max(8, Math.round(bild.width * s)), h = Math.max(8, Math.round(bild.height * s));
  const c = leinwand(w, h);
  const g = ctx2d(c);
  g.drawImage(bild, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const n = w * h;
  const hell = new Uint8Array(n), bunt = new Uint8Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2];
    const l = Math.round(0.299 * r + 0.587 * gr + 0.114 * b);
    const mx = Math.max(r, gr, b), mn = Math.min(r, gr, b);
    hell[i] = l;
    bunt[i] = mx ? Math.round(((mx - mn) / mx) * 255) : 0;
    hist[l]++;
  }
  const t = otsu(hist, n);
  // Paper: brighter than the threshold and hardly coloured.
  const maske = new Uint8Array(n);
  for (let i = 0; i < n; i++) maske[i] = hell[i] > t && bunt[i] < 110 ? 1 : 0;
  // A light opening (erode, then dilate) cuts thin bright links between the sheet and bright spots around it.
  const nachbarn = (m: Uint8Array, min: boolean) => {
    const o = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = min ? 1 : 0;
      for (let dy = -1; dy <= 1 && v === (min ? 1 : 0); dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        const m2 = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : m[yy * w + xx];
        if (min ? !m2 : m2) { v = min ? 0 : 1; break; }
      }
      o[y * w + x] = v;
    }
    return o;
  };
  const offen = nachbarn(nachbarn(maske, true), false);
  // The largest connected bright area.
  const marke = new Int32Array(n);
  let besteMarke = 0, besteGroesse = 0, naechste = 1;
  const stapel = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    if (!offen[i] || marke[i]) continue;
    let oben = 0, groesse = 0;
    stapel[oben++] = i;
    marke[i] = naechste;
    while (oben) {
      const j = stapel[--oben];
      groesse++;
      const x = j % w, y = (j - x) / w;
      if (x > 0 && offen[j - 1] && !marke[j - 1]) { marke[j - 1] = naechste; stapel[oben++] = j - 1; }
      if (x < w - 1 && offen[j + 1] && !marke[j + 1]) { marke[j + 1] = naechste; stapel[oben++] = j + 1; }
      if (y > 0 && offen[j - w] && !marke[j - w]) { marke[j - w] = naechste; stapel[oben++] = j - w; }
      if (y < h - 1 && offen[j + w] && !marke[j + w]) { marke[j + w] = naechste; stapel[oben++] = j + w; }
    }
    if (groesse > besteGroesse) { besteGroesse = groesse; besteMarke = naechste; }
    naechste++;
  }
  const anteil = besteGroesse / n;
  if (anteil < 0.12 || anteil > 0.95) return null;
  // Corners: the outermost points along the two diagonals.
  let tl = { x: 0, y: 0, v: Infinity }, br = { x: 0, y: 0, v: -Infinity }, tr = { x: 0, y: 0, v: -Infinity }, bl = { x: 0, y: 0, v: Infinity };
  let rand = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (marke[y * w + x] !== besteMarke) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) rand++;
    const summe = x + y, diff = x - y;
    if (summe < tl.v) tl = { x, y, v: summe };
    if (summe > br.v) br = { x, y, v: summe };
    if (diff > tr.v) tr = { x, y, v: diff };
    if (diff < bl.v) bl = { x, y, v: diff };
  }
  // A "sheet" running along much of the picture's edge is the background, not a sheet.
  if (rand > (w + h) * 0.6) return null;
  const ecken = [tl, tr, br, bl].map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 }));
  // The area must look like a four-cornered sheet: the corners enclose about the bright area, the angles are sane.
  const q = flaeche(ecken);
  if (!q || besteGroesse / q < 0.82 || besteGroesse / q > 1.12) return null;
  for (let i = 0; i < 4; i++) {
    const a = ecken[(i + 3) % 4], b = ecken[i], c2 = ecken[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c2.x - b.x, y: c2.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    if (Math.abs(cos) > 0.6) return null;
  }
  return ecken.map((p) => ({ x: p.x / s, y: p.y / s }));
}

// Solves A·x = b (8×8) by Gaussian elimination.
function loesen(a: number[][], b: number[]) {
  const m = a.map((z, i) => [...z, b[i]]);
  const k = b.length;
  for (let i = 0; i < k; i++) {
    let p = i;
    for (let j = i + 1; j < k; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
    [m[i], m[p]] = [m[p], m[i]];
    for (let j = i + 1; j < k; j++) {
      const f = m[j][i] / m[i][i];
      for (let c = i; c <= k; c++) m[j][c] -= f * m[i][c];
    }
  }
  const x = new Array(k).fill(0);
  for (let i = k - 1; i >= 0; i--) {
    let s = m[i][k];
    for (let c = i + 1; c < k; c++) s -= m[i][c] * x[c];
    x[i] = s / m[i][i];
  }
  return x;
}

// The homography that takes the corners of the target rectangle (w × h) to the four given points.
export function homographie(ziel: Punkt[], quelle: Punkt[]) {
  const a: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = ziel[i], { x: u, y: v } = quelle[i];
    a.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    a.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  return [...loesen(a, b), 1];
}

const abstand = (a: Punkt, b: Punkt) => Math.hypot(a.x - b.x, a.y - b.y);

// The sheet within its four corners, pulled into a rectangle (at most `max` pixels on the long side).
export function entzerren(bild: CanvasImageSource & { width: number; height: number }, ecken: Punkt[], max = 2200): HTMLCanvasElement {
  // The source at a working size (a 12-megapixel photo is more than the page needs).
  const sq = Math.min(1, 3000 / Math.max(bild.width, bild.height));
  const qw = Math.round(bild.width * sq), qh = Math.round(bild.height * sq);
  const qc = leinwand(qw, qh);
  ctx2d(qc).drawImage(bild, 0, 0, qw, qh);
  const q = ctx2d(qc).getImageData(0, 0, qw, qh).data;
  const e = ecken.map((p) => ({ x: p.x * sq, y: p.y * sq }));
  let bw = Math.max(abstand(e[0], e[1]), abstand(e[3], e[2]));
  let bh = Math.max(abstand(e[0], e[3]), abstand(e[1], e[2]));
  const f = Math.min(1, max / Math.max(bw, bh));
  bw = Math.max(1, Math.round(bw * f)); bh = Math.max(1, Math.round(bh * f));
  const H = homographie([{ x: 0, y: 0 }, { x: bw, y: 0 }, { x: bw, y: bh }, { x: 0, y: bh }], e);
  const out = leinwand(bw, bh);
  const og = ctx2d(out);
  const bildDaten = og.createImageData(bw, bh);
  const z = bildDaten.data;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const px = x + 0.5, py = y + 0.5;
      const nn = H[6] * px + H[7] * py + 1;
      let u = (H[0] * px + H[1] * py + H[2]) / nn - 0.5;
      let v = (H[3] * px + H[4] * py + H[5]) / nn - 0.5;
      u = Math.min(qw - 1.001, Math.max(0, u)); v = Math.min(qh - 1.001, Math.max(0, v));
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * qw + x0) * 4, i10 = i00 + 4, i01 = i00 + qw * 4, i11 = i01 + 4;
      const o = (y * bw + x) * 4;
      for (let k = 0; k < 3; k++) {
        const oben = q[i00 + k] + (q[i10 + k] - q[i00 + k]) * fx;
        const unten = q[i01 + k] + (q[i11 + k] - q[i01 + k]) * fx;
        z[o + k] = oben + (unten - oben) * fy;
      }
      z[o + 3] = 255;
    }
  }
  og.putImageData(bildDaten, 0, 0);
  return out;
}

// The whole picture, only made smaller.
export function verkleinern(bild: CanvasImageSource & { width: number; height: number }, max = 2200) {
  const f = Math.min(1, max / Math.max(bild.width, bild.height));
  const c = leinwand(bild.width * f, bild.height * f);
  ctx2d(c).drawImage(bild, 0, 0, c.width, c.height);
  return c;
}

// Even colours: per channel the darkest and the paper-white values are stretched to black and white (also takes out a
// yellow cast of lamp light). grau: one grey channel, which reads best and makes small files.
export function aufbereiten(c: HTMLCanvasElement, filter: Filter) {
  if (filter === 'original') return c;
  const g = ctx2d(c);
  const bd = g.getImageData(0, 0, c.width, c.height);
  const d = bd.data;
  const n = c.width * c.height;
  const hist = [0, 1, 2].map(() => new Uint32Array(256));
  const schritt = Math.max(1, Math.floor(n / 200_000));
  let gezaehlt = 0;
  for (let i = 0; i < n; i += schritt) { for (let k = 0; k < 3; k++) hist[k][d[i * 4 + k]]++; gezaehlt++; }
  const perzentil = (h: Uint32Array, p: number) => { let s = 0; for (let i = 0; i < 256; i++) { s += h[i]; if (s >= gezaehlt * p) return i; } return 255; };
  const tabellen = hist.map((h) => {
    // Paper white first; the black point at most 120 below it – on a nearly empty page the darkest percent is paper
    // too, and the page would turn black.
    const hi = Math.max(60, perzentil(h, 0.92));
    const lo = Math.min(perzentil(h, 0.01), hi - 120 > 0 ? hi - 120 : 0);
    const t = new Uint8ClampedArray(256);
    // A slight gamma below 1 keeps thin writing dark when the paper is pushed to white.
    for (let v = 0; v < 256; v++) t[v] = 255 * Math.pow(Math.min(1, Math.max(0, (v - lo) / (hi - lo))), 1.15);
    return t;
  });
  for (let i = 0; i < n * 4; i += 4) {
    const r = tabellen[0][d[i]], gr = tabellen[1][d[i + 1]], b = tabellen[2][d[i + 2]];
    if (filter === 'grau') { const l = 0.299 * r + 0.587 * gr + 0.114 * b; d[i] = d[i + 1] = d[i + 2] = l; } else { d[i] = r; d[i + 1] = gr; d[i + 2] = b; }
  }
  g.putImageData(bd, 0, 0);
  return c;
}

// Turned by a quarter, half or three quarters (clockwise).
export function drehen(c: HTMLCanvasElement, viertel: number) {
  const v = ((viertel % 4) + 4) % 4;
  if (!v) return c;
  const out = leinwand(v % 2 ? c.height : c.width, v % 2 ? c.width : c.height);
  const g = ctx2d(out);
  g.translate(out.width / 2, out.height / 2);
  g.rotate((v * Math.PI) / 2);
  g.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

export const alsJpeg = (c: HTMLCanvasElement, qualitaet = 0.82) =>
  new Promise<Blob>((ok, nein) => c.toBlob((b) => (b ? ok(b) : nein(new Error('Bild konnte nicht erzeugt werden.'))), 'image/jpeg', qualitaet));
