// Hidden helper page: reads PDF text with pdf.js and renders pages without a text layer for OCR.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

type Seite = { nr: number; text: string; bild?: string };

// A page with fewer characters than this is treated as a scan.
const MIN_ZEICHEN = 40;

async function pdfLesen(url: string): Promise<{ seiten: Seite[] }> {
  const daten = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const aufgabe = getDocument({ data: daten });
  const pdf = await aufgabe.promise;
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
  return { seiten };
}

(window as unknown as { pdfLesen: typeof pdfLesen }).pdfLesen = pdfLesen;
