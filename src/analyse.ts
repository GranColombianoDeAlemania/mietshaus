// Hidden helper page: reads PDF text with pdf.js and renders pages without a text layer for OCR.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

type Seite = { nr: number; text: string; bild?: string };

// A page with fewer characters than this is treated as a scan.
const MIN_ZEICHEN = 40;

// ZUGFeRD / Factur-X / XRechnung: the invoice data is an XML file embedded in the PDF.
const EXML = /^(factur-x|zugferd-invoice|zugferd_invoice|xrechnung|zugferd).*\.xml$/i;

async function pdfLesen(url: string): Promise<{ seiten: Seite[]; xml: string | null }> {
  const daten = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const aufgabe = getDocument({ data: daten });
  const pdf = await aufgabe.promise;
  let xml: string | null = null;
  try {
    // pdf.js 6: a Map of id → { filename }, the content is fetched separately.
    const anhaenge = (await pdf.getAttachments()) as Map<string, { filename: string }> | null;
    const liste = anhaenge ? [...anhaenge.entries()].map(([id, a]) => ({ id, name: a.filename ?? id })) : [];
    const a = liste.find((x) => EXML.test(x.name)) ?? liste.find((x) => /\.xml$/i.test(x.name));
    if (a) {
      const inhalt = await (pdf as unknown as { getAttachmentContent: (id: string) => Promise<Uint8Array | null> }).getAttachmentContent(a.id);
      if (inhalt) xml = new TextDecoder('utf-8').decode(inhalt);
    }
  } catch {
    // A broken attachment must not stop reading the text.
  }
  const seiten: Seite[] = [];
  for (let nr = 1; nr <= pdf.numPages; nr++) {
    const page = await pdf.getPage(nr);
    const inhalt = await page.getTextContent();
    // Keep line breaks: pdf.js marks the end of a line with hasEOL.
    const text = inhalt.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n');
    if (text.replace(/\s/g, '').length >= MIN_ZEICHEN) {
      seiten.push({ nr, text });
      continue;
    }
    // About 200 dpi, which Tesseract reads well.
    const viewport = page.getViewport({ scale: 2.8 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    seiten.push({ nr, text, bild: canvas.toDataURL('image/png') });
    page.cleanup();
  }
  await aufgabe.destroy();
  return { seiten, xml };
}

(window as unknown as { pdfLesen: typeof pdfLesen }).pdfLesen = pdfLesen;
