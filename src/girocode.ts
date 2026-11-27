// GiroCode (EPC QR code, EPC069-12 version 002) for letters that ask for money: the recipient scans it with the
// banking app and gets payee, IBAN, amount and reference filled in. Error correction M as the standard requires.
import qrcode from 'qrcode-generator';
import { esc } from './dokument';
import type { Absender } from './dokument';

qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

const euro = (ct: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(ct / 100);
const nurZeichen = (s: string, max: number) => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The payload: one field per line, empty lines for unused fields (purpose code, structured reference).
export function epcDaten(o: { name: string; iban: string; bic?: string | null; betrag_ct: number; zweck: string }) {
  return ['BCD', '002', '1', 'SCT', (o.bic ?? '').replace(/\s/g, '').toUpperCase(), nurZeichen(o.name, 70), o.iban.replace(/\s/g, '').toUpperCase(),
    `EUR${(o.betrag_ct / 100).toFixed(2)}`, '', '', nurZeichen(o.zweck, 140)].join('\n');
}

export function girocodeSvg(daten: string) {
  const q = qrcode(0, 'M');
  q.addData(daten, 'Byte');
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// Block for a letter: the code with a short explanation. Empty when there is no account or nothing to pay; an amount
// above what the standard allows (999,999,999.99 €) gets no code either.
export function girocode(a: Absender, betrag_ct: number, zweck: string) {
  if (!a.iban || !(betrag_ct >= 1) || betrag_ct > 99999999999) return '';
  const name = a.kontoinhaber || a.name;
  const svg = girocodeSvg(epcDaten({ name, iban: a.iban, bic: a.bic, betrag_ct, zweck }));
  return `<div class="girocode">${svg}<div><b>Bequem bezahlen mit GiroCode</b><br>Mit der Banking-App scannen – Empfänger, IBAN, Betrag und
    Verwendungszweck sind dann schon ausgefüllt.<br>${esc(name)} · IBAN ${esc(a.iban)} · ${euro(betrag_ct)}<br>Verwendungszweck: ${esc(nurZeichen(zweck, 140))}</div></div>`;
}
