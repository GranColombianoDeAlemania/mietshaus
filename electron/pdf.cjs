// Reads PDFs in plain Node (no browser window), so the same code runs in the Mac app and in the server on the NAS:
// the text layer of each page, an embedded e-invoice (ZUGFeRD / Factur-X / XRechnung) and, for pages without text
// (scans), a rendering as PNG for OCR. pdf.js draws with @napi-rs/canvas in Node.

// A page with fewer characters than this is treated as a scan.
const MIN_ZEICHEN = 40;
// The XML file embedded in an e-invoice PDF.
const EXML = /^(factur-x|zugferd-invoice|zugferd_invoice|xrechnung|zugferd).*\.xml$/i;

let pdfjs = null;
const laden = async () => (pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs'));

// daten: Buffer or Uint8Array of the PDF. Returns { seiten: [{ nr, text, bild?: Buffer }], xml }.
async function pdfLesen(daten) {
  const { getDocument } = await laden();
  const aufgabe = getDocument({ data: new Uint8Array(daten), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const pdf = await aufgabe.promise;
  try {
    let xml = null;
    try {
      // pdf.js 6: a Map of id → { filename }, the content is fetched separately.
      const anhaenge = await pdf.getAttachments();
      const liste = anhaenge ? [...anhaenge.entries()].map(([id, a]) => ({ id, name: a.filename ?? id })) : [];
      const a = liste.find((x) => EXML.test(x.name)) ?? liste.find((x) => /\.xml$/i.test(x.name));
      if (a) {
        const inhalt = await pdf.getAttachmentContent(a.id);
        if (inhalt) xml = new TextDecoder('utf-8').decode(inhalt);
      }
    } catch {
      // A broken attachment must not stop reading the text.
    }
    const seiten = [];
    for (let nr = 1; nr <= pdf.numPages; nr++) {
      const page = await pdf.getPage(nr);
      const inhalt = await page.getTextContent();
      // Keep line breaks: pdf.js marks the end of a line with hasEOL.
      const text = inhalt.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n');
      if (text.replace(/\s/g, '').length >= MIN_ZEICHEN) {
        seiten.push({ nr, text });
        page.cleanup();
        continue;
      }
      // About 200 dpi, which Tesseract reads well.
      const viewport = page.getViewport({ scale: 2.8 });
      const { createCanvas } = require('@napi-rs/canvas');
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      seiten.push({ nr, text, bild: canvas.toBuffer('image/png') });
      page.cleanup();
    }
    return { seiten, xml };
  } finally {
    await aufgabe.destroy();
  }
}

module.exports = { pdfLesen };
