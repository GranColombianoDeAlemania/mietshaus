// HTML documents for PDF output: letters in DIN 5008 layout and plain reports.
import { briefName, call, datum, heute, type Row } from './api';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Turns plain text with line breaks into paragraphs.
export const absaetze = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

const CSS = `
@page { size: A4; margin: 12mm 18mm 15mm 25mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 10pt/1.4 Helvetica, Arial, sans-serif; color: #111; }
.seite { position: relative; page-break-after: always; }
.seite:last-child { page-break-after: auto; }
.kopf { text-align: right; font-size: 9pt; color: #444; height: 20mm; }
.kopf b { font-size: 11pt; color: #111; }
.ruecksende { font-size: 7pt; color: #555; border-bottom: 0.5pt solid #999; display: inline-block; margin-bottom: 2mm; }
/* Positions follow DIN 5008 form B, measured from the top page margin. */
.anschrift { position: absolute; top: 33mm; left: 0; width: 85mm; height: 40mm; }
.infoblock { position: absolute; top: 38mm; right: 0; width: 62mm; font-size: 9pt; }
.infoblock td { padding: 0 0 0 4mm; }
.inhalt { padding-top: 63mm; }
h1 { font-size: 12pt; margin: 0 0 5mm; }
h2 { font-size: 10.5pt; margin: 5mm 0 2mm; page-break-after: avoid; }
p { margin: 0 0 2.5mm; }
table.t { width: 100%; border-collapse: collapse; margin: 2mm 0 3mm; font-size: 9pt; }
table.t th, table.t td { padding: 1mm 1.5mm; border-bottom: 0.4pt solid #bbb; text-align: left; vertical-align: top; }
table.t th { background: #eee; font-weight: bold; }
table.t tr { page-break-inside: avoid; }
table.t .r, .r { text-align: right; white-space: nowrap; }
table.t tr.summe td { font-weight: bold; border-top: 0.8pt solid #333; border-bottom: none; }
table.t tr.zwischen td { font-weight: bold; background: #f6f6f6; }
.fuss { margin-top: 8mm; font-size: 7.5pt; color: #555; border-top: 0.5pt solid #aaa; padding-top: 2mm; display: flex; justify-content: space-between; gap: 6mm; page-break-inside: avoid; }
.bericht .inhalt { padding-top: 0; }
.klein { font-size: 8pt; color: #444; }
.hervor { background: #f2f2f2; padding: 2.5mm 4mm; margin: 3mm 0; font-weight: bold; }
.unterschrift { margin-top: 8mm; page-break-inside: avoid; }
table.unterschriften { width: 100%; margin-top: 14mm; border-collapse: collapse; page-break-inside: avoid; }
table.unterschriften td { width: 50%; vertical-align: bottom; font-size: 9pt; color: #333; padding-right: 8mm; }
`;

export type Absender = { name: string; strasse?: string; ort?: string; telefon?: string; email?: string; bank?: string; iban?: string; bic?: string };

export const absenderAus = (e: Row): Absender => ({
  name: e.verwalter_name || 'Hausverwaltung',
  strasse: e.verwalter_strasse,
  ort: [e.verwalter_plz, e.verwalter_ort].filter(Boolean).join(' '),
  telefon: e.verwalter_telefon,
  email: e.verwalter_email,
  bank: e.verwalter_bank,
  iban: e.verwalter_iban,
  bic: e.verwalter_bic,
});

const fuss = (a: Absender) => `<div class="fuss">
  <div>${esc(a.name)}<br>${esc(a.strasse)}<br>${esc(a.ort)}</div>
  <div>${a.telefon ? 'Tel. ' + esc(a.telefon) + '<br>' : ''}${esc(a.email)}</div>
  <div>${a.bank ? esc(a.bank) + '<br>' : ''}${a.iban ? 'IBAN ' + esc(a.iban) : ''}${a.bic ? '<br>BIC ' + esc(a.bic) : ''}</div>
</div>`;

// Recipient of a contract letter: the contract party with the second tenant or owner (mit), so legal declarations
// reach everyone. Without an own address the unit's address is used.
export async function empfaengerVon(v: Row): Promise<Row> {
  const e = v.einheit_id ? await call('get', 'einheiten', v.einheit_id) : null;
  const o = e ? await call('get', 'objekte', e.objekt_id) : null;
  const adresse = (p: Row) => (p.strasse || !o ? p : { ...p, strasse: o.strasse, plz: o.plz, ort: o.ort });
  const p = adresse(await call('get', 'personen', v.person_id));
  const p2 = v.person2_id ? adresse(await call('get', 'personen', v.person2_id)) : null;
  return p2 ? { ...p, mit: p2 } : p;
}

export function brief(opts: {
  absender: Absender;
  empfaenger: Row;
  betreff: string;
  inhalt: string;
  info?: [string, string][];
  // null: no date (forms the recipient fills in and signs).
  datum?: string | null;
}) {
  const e = opts.empfaenger;
  const a = opts.absender;
  const zeilen = [e.firma && e.nachname ? e.firma : null, briefName(e) || e.firma, e.mit ? briefName(e.mit) || e.mit.firma : null, e.strasse, [e.plz, e.ort].filter(Boolean).join(' '),
    e.land && e.land !== 'Deutschland' ? e.land : null].filter(Boolean);
  return `<div class="seite">
    <div class="kopf"><b>${esc(a.name)}</b><br>${esc(a.strasse)} · ${esc(a.ort)}</div>
    <div class="anschrift">
      <div class="ruecksende">${esc([a.name, a.strasse, a.ort].filter(Boolean).join(' · '))}</div>
      <div>${zeilen.map(esc).join('<br>')}</div>
    </div>
    <div class="infoblock"><table>
      ${(opts.info ?? []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}
      ${opts.datum === null ? '' : `<tr><td>Datum</td><td>${datum(opts.datum ?? heute())}</td></tr>`}
    </table></div>
    <div class="inhalt"><h1>${esc(opts.betreff)}</h1>${opts.inhalt}</div>
    ${fuss(a)}
  </div>`;
}

export function bericht(titel: string, untertitel: string, inhalt: string) {
  return `<div class="seite bericht"><div class="inhalt">
    <h1>${esc(titel)}</h1><p class="klein">${esc(untertitel)}</p>${inhalt}</div></div>`;
}

export const dokument = (seiten: string[], titel = 'Dokument') =>
  `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(titel)}</title><style>${CSS}</style></head><body>${seiten.join('')}</body></html>`;

// Generic table: rows of cells; cells starting with "#r" are right-aligned.
export function tabelle(kopf: string[], zeilen: (string | number)[][], opts: { summe?: (string | number)[]; klassen?: (string | undefined)[] } = {}) {
  const zelle = (c: string | number, tag: string) => {
    const s = String(c);
    return s.startsWith('#r') ? `<${tag} class="r">${s.slice(2)}</${tag}>` : `<${tag}>${s}</${tag}>`;
  };
  return `<table class="t"><thead><tr>${kopf.map((k) => zelle(k, 'th')).join('')}</tr></thead><tbody>
    ${zeilen.map((z, i) => `<tr${opts.klassen?.[i] ? ` class="${opts.klassen[i]}"` : ''}>${z.map((c) => zelle(c, 'td')).join('')}</tr>`).join('')}
    ${opts.summe ? `<tr class="summe">${opts.summe.map((c) => zelle(c, 'td')).join('')}</tr>` : ''}
  </tbody></table>`;
}

export async function alsPdf(seiten: string[], name: string) {
  return window.hv.pdf(dokument(seiten, name), name.endsWith('.pdf') ? name : `${name}.pdf`);
}

// Files a generated document in the archive instead of asking where to save it.
export async function alsPdfAblegen(seiten: string[], name: string, meta: Record<string, unknown>) {
  return window.hv.pdfAblegen(dokument(seiten, name), name.endsWith('.pdf') ? name : `${name}.pdf`, meta);
}
