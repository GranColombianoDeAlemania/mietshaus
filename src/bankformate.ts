// Parsers for bank statement files and writers for SEPA payment files.

export type Umsatz = { ref: string; datum: string; betrag_ct: number; name: string; iban: string; zweck: string };

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

// Detects the format from the content: CAMT.052/053/054 XML, MT940 or CSV.
export function leseKontoauszug(bytes: Uint8Array): Umsatz[] {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  if (/<\?xml|<Document/.test(utf8.slice(0, 2000))) return camt(utf8);
  const text = utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  if (/:20:|:61:/.test(text)) return mt940(text);
  return csv(text);
}

function camt(xml: string): Umsatz[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const tag = (el: Element | Document, name: string) => el.getElementsByTagNameNS('*', name);
  const text = (el: Element | null | undefined, ...pfad: string[]) => {
    let cur: Element | null | undefined = el;
    for (const p of pfad) cur = cur ? tag(cur, p)[0] : null;
    return cur?.textContent?.trim() ?? '';
  };
  const out: Umsatz[] = [];
  for (const e of Array.from(tag(doc, 'Ntry'))) {
    const betrag = Math.round(Number(text(e, 'Amt')) * 100);
    const ein = text(e, 'CdtDbtInd') === 'CRDT';
    const datum = (text(e, 'BookgDt', 'Dt') || text(e, 'BookgDt', 'DtTm') || text(e, 'ValDt', 'Dt')).slice(0, 10);
    const gegen = ein ? 'Dbtr' : 'Cdtr';
    const gegenKonto = ein ? 'DbtrAcct' : 'CdtrAcct';
    const name = text(e, 'RltdPties', gegen, 'Nm') || text(e, 'RltdPties', gegen, 'Pty', 'Nm');
    const iban = text(e, 'RltdPties', gegenKonto, 'IBAN');
    const zweck = Array.from(tag(e, 'Ustrd')).map((u) => u.textContent?.trim()).join(' ') || text(e, 'AddtlNtryInf');
    const id = text(e, 'AcctSvcrRef') || text(e, 'NtryRef') || text(e, 'EndToEndId');
    out.push({ ref: 'camt:' + (id && id !== 'NOTPROVIDED' ? id : hash(`${datum}|${betrag}|${name}|${zweck}`)), datum, betrag_ct: ein ? betrag : -betrag, name, iban, zweck });
  }
  return out;
}

// Identical transactions on the same day get a running number, so re-imports of overlapping files are still recognised.
function zaehler() {
  const n = new Map<string, number>();
  return (key: string) => {
    const i = (n.get(key) ?? 0) + 1;
    n.set(key, i);
    return hash(key) + (i > 1 ? `-${i}` : '');
  };
}

function mt940(text: string): Umsatz[] {
  const out: Umsatz[] = [];
  const id = zaehler();
  const felder = text.replace(/\r/g, '').split(/\n(?=:\d\d[A-Z]?:)/);
  for (let i = 0; i < felder.length; i++) {
    const f = felder[i];
    if (!f.startsWith(':61:')) continue;
    const m = /^:61:(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])([A-Z])?([\d,]+)/.exec(f);
    if (!m) continue;
    const datum = `20${m[1]}-${m[2]}-${m[3]}`;
    const betrag = Math.round(Number(m[7].replace(',', '.')) * 100);
    const ein = m[5] === 'C' || m[5] === 'RD';
    const info = felder[i + 1]?.startsWith(':86:') ? felder[i + 1].slice(4).replace(/\n/g, '') : '';
    // Structured :86: subfields: ?20–?29 purpose, ?31 account or IBAN, ?32/?33 name, ?38 IBAN.
    const sub: Record<string, string> = {};
    for (const s of info.split('?').slice(1)) sub[s.slice(0, 2)] = (sub[s.slice(0, 2)] ?? '') + s.slice(2);
    const zweck = Object.keys(sub).filter((k) => k >= '20' && k <= '29').sort().map((k) => sub[k]).join('') || info;
    const name = ((sub['32'] ?? '') + (sub['33'] ?? '')).trim();
    out.push({ ref: 'mt940:' + id(`${datum}|${betrag}|${ein}|${name}|${zweck}`), datum, betrag_ct: ein ? betrag : -betrag, name, iban: sub['38'] || (/^[A-Z]{2}\d{2}/.test(sub['31'] ?? '') ? sub['31'] : ''), zweck: zweck.trim() });
  }
  return out;
}

// Generic CSV export: looks for date, amount, name, IBAN and purpose columns by header name.
function csv(text: string): Umsatz[] {
  const zeilen = text.split(/\r?\n/).filter((z) => z.trim());
  const trenner = (zeilen[0].match(/;/g)?.length ?? 0) >= (zeilen[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (z: string) => {
    const out: string[] = [];
    let cur = '', q = false;
    for (const c of z) {
      if (c === '"') q = !q;
      else if (c === trenner && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const kopfIdx = zeilen.findIndex((z) => /datum|date|buchungstag|valuta/i.test(z) && /betrag|amount|umsatz/i.test(z));
  if (kopfIdx < 0) throw new Error('Unbekanntes Dateiformat. Unterstützt werden CAMT (XML), MT940 und CSV mit Spalten Datum und Betrag.');
  const kopf = split(zeilen[kopfIdx]).map((k) => k.toLowerCase());
  const spalte = (...namen: RegExp[]) => kopf.findIndex((k) => namen.some((n) => n.test(k)));
  const iDatum = spalte(/buchungstag|buchungsdatum/, /^datum/, /date/);
  const iBetrag = spalte(/^betrag/, /amount/, /umsatz/);
  const iName = spalte(/empfänger|auftraggeber|name|zahlungspflichtige|beguenstigter|begünstigter/);
  const iIban = spalte(/iban/);
  const iZweck = spalte(/verwendungszweck|zweck|purpose|buchungstext/);
  const out: Umsatz[] = [];
  const id = zaehler();
  for (const z of zeilen.slice(kopfIdx + 1)) {
    const c = split(z);
    const d = c[iDatum] ?? '';
    const dm = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(d);
    const datum = dm ? `${dm[3].length === 2 ? '20' + dm[3] : dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : d.slice(0, 10);
    const b = (c[iBetrag] ?? '').replace(/[^\d,.-]/g, '');
    const betrag = Math.round(Number(b.includes(',') ? b.replace(/\./g, '').replace(',', '.') : b) * 100);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || !Number.isFinite(betrag) || !betrag) continue;
    const name = c[iName] ?? '', zweck = c[iZweck] ?? '', iban = c[iIban] ?? '';
    out.push({ ref: 'csv:' + id(`${datum}|${betrag}|${name}|${zweck}`), datum, betrag_ct: betrag, name, iban, zweck });
  }
  return out;
}

const x = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
// SEPA only allows a restricted Latin character set (EPC): umlauts are spelled out, "&" becomes "+", the rest a space.
const sepaText = (s: string, max: number) =>
  x((s ?? '').replace(/[ä]/g, 'ae').replace(/[ö]/g, 'oe').replace(/[ü]/g, 'ue').replace(/[Ä]/g, 'Ae').replace(/[Ö]/g, 'Oe').replace(/[Ü]/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/&/g, '+').replace(/[^A-Za-z0-9 /\-?:().,'+]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim());
const ibanNorm = (s: string) => (s ?? '').replace(/\s/g, '').toUpperCase();
const betragStr = (ct: number) => (ct / 100).toFixed(2);

export type Lastschrift = { name: string; iban: string; bic?: string; betrag_ct: number; mandat: string; mandatDatum: string; zweck: string; e2e: string };

// pain.008.001.08 SEPA core direct debit (CORE, recurring).
export function painLastschrift(opts: { glaeubiger: string; glaeubigerId: string; iban: string; bic?: string; faellig: string; posten: Lastschrift[] }) {
  const id = `HV${Date.now()}`;
  const summe = opts.posten.reduce((s, p) => s + p.betrag_ct, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.08">
<CstmrDrctDbtInitn>
<GrpHdr><MsgId>${id}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${opts.posten.length}</NbOfTxs><CtrlSum>${betragStr(summe)}</CtrlSum><InitgPty><Nm>${sepaText(opts.glaeubiger, 70)}</Nm></InitgPty></GrpHdr>
<PmtInf><PmtInfId>${id}-1</PmtInfId><PmtMtd>DD</PmtMtd><NbOfTxs>${opts.posten.length}</NbOfTxs><CtrlSum>${betragStr(summe)}</CtrlSum>
<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl><LclInstrm><Cd>CORE</Cd></LclInstrm><SeqTp>RCUR</SeqTp></PmtTpInf>
<ReqdColltnDt>${opts.faellig}</ReqdColltnDt>
<Cdtr><Nm>${sepaText(opts.glaeubiger, 70)}</Nm></Cdtr>
<CdtrAcct><Id><IBAN>${ibanNorm(opts.iban)}</IBAN></Id></CdtrAcct>
<CdtrAgt><FinInstnId>${opts.bic ? `<BICFI>${x(opts.bic)}</BICFI>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></CdtrAgt>
<ChrgBr>SLEV</ChrgBr>
<CdtrSchmeId><Id><PrvtId><Othr><Id>${x(opts.glaeubigerId)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>
${opts.posten.map((p) => `<DrctDbtTxInf><PmtId><EndToEndId>${sepaText(p.e2e, 35)}</EndToEndId></PmtId><InstdAmt Ccy="EUR">${betragStr(p.betrag_ct)}</InstdAmt>
<DrctDbtTx><MndtRltdInf><MndtId>${sepaText(p.mandat, 35)}</MndtId><DtOfSgntr>${p.mandatDatum}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
<DbtrAgt><FinInstnId>${p.bic ? `<BICFI>${x(p.bic)}</BICFI>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>
<Dbtr><Nm>${sepaText(p.name, 70)}</Nm></Dbtr><DbtrAcct><Id><IBAN>${ibanNorm(p.iban)}</IBAN></Id></DbtrAcct>
<RmtInf><Ustrd>${sepaText(p.zweck, 140)}</Ustrd></RmtInf></DrctDbtTxInf>`).join('\n')}
</PmtInf>
</CstmrDrctDbtInitn>
</Document>
`;
}

export type Ueberweisung = { name: string; iban: string; bic?: string; betrag_ct: number; zweck: string; e2e: string };

// pain.001.001.09 SEPA credit transfer.
export function painUeberweisung(opts: { auftraggeber: string; iban: string; bic?: string; ausfuehrung: string; posten: Ueberweisung[] }) {
  const id = `HV${Date.now()}`;
  const summe = opts.posten.reduce((s, p) => s + p.betrag_ct, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
<CstmrCdtTrfInitn>
<GrpHdr><MsgId>${id}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${opts.posten.length}</NbOfTxs><CtrlSum>${betragStr(summe)}</CtrlSum><InitgPty><Nm>${sepaText(opts.auftraggeber, 70)}</Nm></InitgPty></GrpHdr>
<PmtInf><PmtInfId>${id}-1</PmtInfId><PmtMtd>TRF</PmtMtd><NbOfTxs>${opts.posten.length}</NbOfTxs><CtrlSum>${betragStr(summe)}</CtrlSum>
<PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
<ReqdExctnDt><Dt>${opts.ausfuehrung}</Dt></ReqdExctnDt>
<Dbtr><Nm>${sepaText(opts.auftraggeber, 70)}</Nm></Dbtr>
<DbtrAcct><Id><IBAN>${ibanNorm(opts.iban)}</IBAN></Id></DbtrAcct>
<DbtrAgt><FinInstnId>${opts.bic ? `<BICFI>${x(opts.bic)}</BICFI>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>
<ChrgBr>SLEV</ChrgBr>
${opts.posten.map((p) => `<CdtTrfTxInf><PmtId><EndToEndId>${sepaText(p.e2e, 35)}</EndToEndId></PmtId><Amt><InstdAmt Ccy="EUR">${betragStr(p.betrag_ct)}</InstdAmt></Amt>
${p.bic ? `<CdtrAgt><FinInstnId><BICFI>${x(p.bic)}</BICFI></FinInstnId></CdtrAgt>` : ''}
<Cdtr><Nm>${sepaText(p.name, 70)}</Nm></Cdtr><CdtrAcct><Id><IBAN>${ibanNorm(p.iban)}</IBAN></Id></CdtrAcct>
<RmtInf><Ustrd>${sepaText(p.zweck, 140)}</Ustrd></RmtInf></CdtTrfTxInf>`).join('\n')}
</PmtInf>
</CstmrCdtTrfInitn>
</Document>
`;
}

// Checks the IBAN checksum (ISO 13616, mod 97).
export function ibanGueltig(iban: string) {
  const s = ibanNorm(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of r) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}
