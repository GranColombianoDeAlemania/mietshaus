// One PDF from several pages, written by hand (a PDF with only JPEG pages is a few objects), and PDF pages read back as
// pictures (pdf.js, loaded only when needed) so a scanned PDF can join photos in one document.

export type JpegSeite = { jpeg: Uint8Array; breite: number; hoehe: number };

const A4_BREIT = 595.28, A4_LANG = 841.89;

// Each page keeps the picture's proportions: portrait pages are A4 wide, landscape pages A4 long.
export function pdfAusJpegs(seiten: JpegSeite[]): Blob {
  const teile: (string | Uint8Array)[] = [];
  const offsets: number[] = [];
  let laenge = 0;
  const kodierer = new TextEncoder();
  const schreib = (x: string | Uint8Array) => { const b = typeof x === 'string' ? kodierer.encode(x) : x; teile.push(b); laenge += b.length; };
  const objekt = (nr: number, inhalt: string) => { offsets[nr] = laenge; schreib(`${nr} 0 obj\n${inhalt}\nendobj\n`); };
  schreib('%PDF-1.4\n');
  const kids = seiten.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  objekt(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objekt(2, `<< /Type /Pages /Kids [${kids}] /Count ${seiten.length} >>`);
  seiten.forEach((s, i) => {
    const nr = 3 + i * 3;
    const quer = s.breite > s.hoehe;
    const w = quer ? A4_LANG : A4_BREIT;
    const h = Math.round(((w * s.hoehe) / s.breite) * 100) / 100;
    const inhalt = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} 0 0 cm /Bild Do Q`;
    objekt(nr, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] /Resources << /XObject << /Bild ${nr + 2} 0 R >> >> /Contents ${nr + 1} 0 R >>`);
    objekt(nr + 1, `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
    offsets[nr + 2] = laenge;
    schreib(`${nr + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${s.breite} /Height ${s.hoehe} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${s.jpeg.length} >>\nstream\n`);
    schreib(s.jpeg);
    schreib('\nendstream\nendobj\n');
  });
  const anzahl = 3 + seiten.length * 3;
  const xref = laenge;
  let tabelle = `xref\n0 ${anzahl}\n0000000000 65535 f \n`;
  for (let i = 1; i < anzahl; i++) tabelle += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  schreib(`${tabelle}trailer\n<< /Size ${anzahl} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(teile as BlobPart[], { type: 'application/pdf' });
}

type PdfJs = typeof import('pdfjs-dist');
let pdfjs: Promise<PdfJs> | null = null;
const ladePdfJs = () => (pdfjs ??= (async () => {
  const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  m.GlobalWorkerOptions.workerSrc = worker.default;
  return m;
})());

// The pages of a PDF as pictures (about 200 dpi). eRechnung: the PDF carries an e-invoice (its data would be lost when
// the pages become pictures).
export async function pdfSeiten(f: Blob): Promise<{ seiten: HTMLCanvasElement[]; eRechnung: boolean }> {
  const { getDocument } = await ladePdfJs();
  const aufgabe = getDocument({ data: new Uint8Array(await f.arrayBuffer()), verbosity: 0 });
  const pdf = await aufgabe.promise;
  try {
    let eRechnung = false;
    try {
      const a = await pdf.getAttachments();
      const liste = (a ? [...(a instanceof Map ? a.values() : Object.values(a))] : []) as { filename?: string }[];
      eRechnung = liste.some((x) => /\.xml$/i.test(x?.filename ?? ''));
    } catch { /* no attachments */ }
    const seiten: HTMLCanvasElement[] = [];
    for (let nr = 1; nr <= pdf.numPages; nr++) {
      const page = await pdf.getPage(nr);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(2.8, 2200 / Math.max(vp0.width, vp0.height)) });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
      seiten.push(c);
      page.cleanup();
    }
    return { seiten, eRechnung };
  } finally {
    await aufgabe.destroy();
  }
}
