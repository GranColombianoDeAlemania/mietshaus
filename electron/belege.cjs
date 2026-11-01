// Reading invoices without AI: who sent it (letterhead and imprint), the VAT per rate and the line items with their
// kind (labour, travel, material – for § 35a). Pure functions on the recognised text, tested in scripts/rechentest.cjs.
// Whatever does not add up is left empty instead of guessed: the dialog and Claude Desktop fill it in.

const BETRAG = /(?<![\d,.])(-?\d{1,3}(?:\.\d{3})*,\d{2})(?![\d,])/g;
const betragAus = (s) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
const betraege = (z) => [...z.matchAll(BETRAG)].map((m) => betragAus(m[1]));
const flach = (s) => String(s ?? '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
const zeilenAus = (text) => String(text ?? '').replace(/ /g, ' ').split(/\n/).map((z) => z.trim()).filter(Boolean);

// ---------- VAT ----------
const STEUERWORT = /\b(?:mwst|mw\.?-?st|mehrwertsteuer|ust|umsatzsteuer|vat)\b/i;
const KEINE_STEUERZEILE = /ust[\s.-]*id|ident|steuer-?\s?nr|steuernummer|st\.?-?nr/i;
const NULLSATZ = /§\s*19\s*(?:abs\.?\s*1\s*)?ustg|kleinunternehmer|umsatzsteuerfrei|steuerfreie?\b|§\s*4\s*nr\.?\s*\d+[a-z]?\s*(?:[a-z]+\s*)?ustg|ohne\s+(?:mwst|ust|umsatzsteuer)|nicht\s+(?:umsatz)?steuerbar|reverse\s*charge|§\s*13b\s*ustg/i;
const SATZ = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/;

// The VAT of an invoice with the gross amount brutto: [{satz, netto_ct, ust_ct}] or null. A rate only counts when
// net + VAT give the gross amount and VAT is the rate of the net amount (both to a few cents).
function steuerErkennen(text, brutto) {
  const zeilen = zeilenAus(text);
  const kandidaten = new Map(); // rate → [{ust, basis}]
  let inklusive = null;
  let netto = null;
  const hatSteuerwort = zeilen.some((z) => STEUERWORT.test(z) && !KEINE_STEUERZEILE.test(z));
  for (const z of zeilen) {
    const nm = /(?:netto(?:betrag|summe)?|summe\s+netto|gesamt\s*netto|zwischensumme|warenwert|rechnungsbetrag\s+netto)\b[^\d\n]{0,30}(\d{1,3}(?:\.\d{3})*,\d{2})/i.exec(z);
    if (nm && !STEUERWORT.test(z.slice(0, nm.index + 1))) netto = betragAus(nm[1]);
    const steuerzeile = STEUERWORT.test(z) && !KEINE_STEUERZEILE.test(z);
    // Table rows of a VAT summary: "19 % 41,10 7,81" (only when the document speaks of VAT at all).
    const tabelle = !steuerzeile && hatSteuerwort && /^\D{0,3}\d{1,2}(?:[.,]\d{1,2})?\s*%(?:\s+\S*)?\s+-?\d/.test(z);
    if (!steuerzeile && !tabelle) continue;
    const s = SATZ.exec(z);
    if (!s) continue;
    const satz = Number(s[1].replace(',', '.'));
    if (!(satz > 0 && satz <= 25)) continue;
    // "inkl. 19 % MwSt" names the rate in the gross amount: an amount before it is the gross, not the VAT.
    const inkl = /inkl|enthalten|incl/i.test(z);
    const danach = betraege(z.slice(s.index + s[0].length)).filter((x) => x > 0);
    const b = inkl ? danach : danach.concat(betraege(z.slice(0, s.index)).filter((x) => x > 0));
    if (inkl && !b.length) { inklusive = satz; continue; }
    const liste = kandidaten.get(satz) ?? [];
    if (b.length >= 2) {
      // Basis and VAT in either order: the pair where one is the rate of the other.
      let paar = null;
      for (const x of b) for (const y of b) if (x !== y && Math.abs(Math.round(x * satz / 100) - y) <= 2) paar ??= { basis: x, ust: y };
      liste.push(paar ?? { ust: b.at(-1), basis: null });
    } else if (b.length === 1) liste.push({ ust: b[0], basis: null });
    kandidaten.set(satz, liste);
  }

  const passt = (teile) => {
    if (!brutto) return teile.every((t) => t.netto_ct > 0 && Math.abs(Math.round(t.netto_ct * t.satz / 100) - t.ust_ct) <= 2);
    const summe = teile.reduce((s, t) => s + t.netto_ct + t.ust_ct, 0);
    return Math.abs(summe - brutto) <= 2 * teile.length && teile.every((t) => t.netto_ct > 0 && Math.abs(Math.round(t.netto_ct * t.satz / 100) - t.ust_ct) <= 2 + Math.ceil(t.satz / 10));
  };
  const saetze = [...kandidaten.entries()].filter(([, l]) => l.length);
  if (saetze.length === 1) {
    const [satz, liste] = saetze[0];
    // From the bottom up (the summary is usually last): the first candidate that adds up.
    for (const k of [...liste].reverse()) {
      const basen = [k.basis, netto, brutto ? brutto - k.ust : null].filter((x) => x != null);
      for (const basis of basen) {
        const t = [{ satz, netto_ct: basis, ust_ct: k.ust }];
        if (passt(t)) return t;
      }
    }
  } else if (saetze.length > 1) {
    const teile = saetze.map(([satz, liste]) => {
      const k = [...liste].reverse().find((x) => x.basis != null) ?? liste.at(-1);
      return { satz, netto_ct: k.basis ?? Math.round(k.ust * 100 / satz), ust_ct: k.ust };
    });
    if (passt(teile)) return teile.sort((a, b) => b.satz - a.satz);
  }
  if (inklusive && brutto) {
    const ust = Math.round(brutto * inklusive / (100 + inklusive));
    return [{ satz: inklusive, netto_ct: brutto - ust, ust_ct: ust, berechnet: true }];
  }
  if (!saetze.length && brutto && NULLSATZ.test(zeilen.join('\n'))) return [{ satz: 0, netto_ct: brutto, ust_ct: 0 }];
  return null;
}

// ---------- line items ----------
const EINHEIT = /(?<![\w,])(\d+(?:,\d+)?)\s*(std\.?|stunden?|std|h|stk\.?|stück|st\.?|m²|m2|qm|m³|m3|lfm|lfd\.?\s?m|m|kg|l|ltr\.?|psch\.?|pauschal|pausch\.?|paar|set|km|tag|tage|einh\.?)(?![\wäöü])/i;
const KOPF = [/\bpos(?:ition)?\b\.?/i, /bezeichnung|beschreibung|artikel|leistung|\btext\b/i, /menge|anzahl|\bstk\b/i, /einzel|e-?preis|\bpreis\b/i, /gesamt|betrag|summe/i];
const ENDE = /^(?:zwischen)?summe|^gesamt|^netto|^rechnungsbetrag|^übertrag|^zzgl|^zuzüglich|^mwst|^ust\b|^umsatzsteuer|^endbetrag|^zu zahlen/i;
const KEIN_POSTEN = /iban|bic\b|seite\s+\d|tel\.?|telefon|fax|e-?mail|www\.|skonto|zahlbar|überweis|ust-?id|steuer-?nr|amtsgericht|\bhr[ab]\b/i;
const ARBEIT = /arbeit|\bstd\b|stunde|monteur|geselle|meister|\blohn|montage|demontage|helfer|techniker|azubi|lehrling|reinigung|pflege|wartung|inspektion|reparatur|einbau|installation|fachkraft|dienstleistung/i;
const ANFAHRT = /anfahrt|fahrtkost|fahrzeug|\bkm\b|wegezeit|wegegeld|fahrt/i;
const MATERIAL = /material|ersatzteil|\bstk\b|stück|kleinteil|dichtung|ventil|rohr|kabel|farbe|lieferung/i;

function artVon(text, einheit) {
  const e = String(einheit ?? '').toLowerCase();
  if (ANFAHRT.test(text) || e === 'km') return 'anfahrt';
  if (/^(std|stunde|h)/.test(e) || ARBEIT.test(text)) return 'arbeit';
  if (/^(stk|stück|st\.?$|m|kg|l|ltr|paar|set)/.test(e) || MATERIAL.test(text)) return 'material';
  return null;
}

// The line items between the table head and the first sum: [{text, menge, einheit, betrag_ct, satz, art}].
function positionenErkennen(text) {
  const zeilen = zeilenAus(text);
  const kopf = zeilen.findIndex((z) => KOPF.filter((k) => k.test(z)).length >= 2 && betraege(z).length === 0);
  const start = kopf >= 0 ? kopf + 1 : 0;
  const out = [];
  for (let i = start; i < zeilen.length; i++) {
    let z = zeilen[i];
    if (ENDE.test(z)) break;
    if (KEIN_POSTEN.test(z)) continue;
    // Text recognition sometimes drops the decimal comma ("87,00" read as "8700"): a bare number of 3–6 digits at the
    // end of an item line counts as cents. The labour share is only taken when the items add up (lohnBerechnen).
    const m = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|eur)?\s*[a-c]?\s*$/i.exec(z) ?? (!/,\d{2}/.test(z) ? /(?<=\s)(\d{3,6})\s*(?:€|eur)?\s*$/i.exec(z) : null);
    if (!m) continue;
    const betrag_ct = m[1].includes(',') ? betragAus(m[1]) : Number(m[1]);
    z = z.slice(0, m.index);
    const s = SATZ.exec(z);
    const satz = s ? Number(s[1].replace(',', '.')) : null;
    if (s) z = z.replace(s[0], ' ');
    const e = EINHEIT.exec(z);
    // Without a table head only lines with quantity and unit count – otherwise every amount line would be an item.
    if (kopf < 0 && !e) continue;
    const menge = e ? Number(e[1].replace(',', '.')) : null;
    const einheit = e ? e[2].replace(/\.$/, '') : null;
    if (e) z = z.replace(e[0], ' ');
    const bezeichnung = z.replace(BETRAG, ' ').replace(/^\s*\d{1,3}(?:\.\d{1,3})?\s+/, '').replace(/\s*[|€]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if ((bezeichnung.match(/[a-zäöüß]/gi) ?? []).length < 3 || betrag_ct === 0) continue;
    out.push({ text: bezeichnung.slice(0, 160), menge, einheit, betrag_ct, satz, art: artVon(bezeichnung, einheit) });
  }
  return out.slice(0, 80);
}

// Labour and travel costs (gross, for § 35a) from the items: items printed net are scaled to gross. null when the
// items do not add up to the invoice (then a missing item could be the labour).
function lohnBerechnen(positionen, { brutto = null, netto = null } = {}) {
  if (!positionen?.length || !positionen.some((p) => p.art === 'arbeit' || p.art === 'anfahrt')) return null;
  const summe = positionen.reduce((s, p) => s + (p.betrag_ct ?? 0), 0);
  const lohn = positionen.filter((p) => p.art === 'arbeit' || p.art === 'anfahrt').reduce((s, p) => s + (p.betrag_ct ?? 0), 0);
  const nah = (a, b) => a && b && Math.abs(a - b) <= Math.max(5, Math.round(b * 0.005));
  if (nah(summe, brutto)) return lohn;
  if (nah(summe, netto) && brutto) return Math.round(lohn * brutto / netto);
  return null;
}

// ---------- sender ----------
const RECHTSFORM = /\b(?:gmbh(?:\s*&\s*co\.?\s*kg)?|ug\s*\(haftungsbeschränkt\)|\bug\b|\bag\b|\bkg\b|\bohg\b|\bgbr\b|e\.\s?k\.|e\.\s?kfm\.?|e\.\s?v\.|\bmbh\b|partg(?:mbb)?|ltd\.?|\bse\b|stadtwerke|werke\b|versicherung|\bamt\b|finanzamt|stadt\s+\w+|gemeinde\s+\w+|sparkasse|bank\b)/i;
const NICHT_NAME = /\b(?:rechnung\w*|gutschrift|angebot|lieferschein|datum|seite|kunden-?nr\.?|kundennummer|empfänger|tel\.?|telefon|fax|e-?mail|iban|bic|ust-?id\w*|steuer-?nr\.?|steuernummer|amtsgericht|geschäftsführ\w*|inhaber\w*|bankverbindung|pos\.?|bezeichnung|menge)\b|www\.|^an\b|^herrn?\b|^frau\b|^\d/i;
const STRASSE = /([A-ZÄÖÜ][\wäöüß.\-]*(?:\s+[A-Za-zÄÖÜäöüß][\wäöüß.\-]*){0,3}?\s*(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee|steig|pfad|markt|hof|berg|feld|garten|park|kamp|stieg)\s*\d{1,4}\s*[a-zA-Z]?(?:\s*[-–/]\s*\d{1,3}\s*[a-zA-Z]?)?)(?!\d)/i;
const PLZORT = /\b(\d{5})\s+([A-ZÄÖÜ][\wäöüß.\-]+(?:\s+(?:[A-ZÄÖÜ][\wäöüß.\-]+|a\.\s?d\.|am|an|der|im|in|bei|ob|vor))*(?:\s*\/\s*[A-ZÄÖÜ][\wäöüß]+)?)/;
const segmente = (z) => z.split(/\s*[|•·●▪◦]\s*|\s+[–-]\s+|\s{3,}|;\s*/).map((s) => s.trim()).filter(Boolean);

// Sender of a letter: name, address, contact, tax ids, register, bank – from the letterhead (first lines) and the
// imprint in the foot of each page. eigene: own names and addresses (manager, objects, tenants), never the sender.
function stellerErkennen(text, eigene = {}) {
  const seiten = String(text ?? '').split(/\f/).map(zeilenAus).filter((s) => s.length);
  if (!seiten.length) return null;
  const kopf = seiten[0].slice(0, 14);
  const fuss = seiten.flatMap((s) => s.slice(-14));
  const alle = seiten.flat();
  const voll = [...kopf, ...fuss].join('\n');
  const ganz = alle.join('\n');
  const eigenNamen = (eigene.namen ?? []).map(flach).filter((n) => n.length > 3);
  const eigenAdressen = (eigene.adressen ?? []).map(flach).filter((n) => n.length > 5);
  const eigenMails = (eigene.emails ?? []).map((e) => String(e).toLowerCase());
  const istEigen = (s) => { const f = flach(s); return f.length > 3 && (eigenNamen.some((n) => f.includes(n) || n.includes(f)) || eigenAdressen.some((a) => f.includes(a) || a.includes(f))); };
  const s = {};
  const treffer = (re, quelle = voll) => re.exec(quelle);

  const ust = [...ganz.matchAll(/\b(DE)\s?(\d{3})\s?(\d{3})\s?(\d{3})\b/g)].map((m) => m.slice(1).join(''))
    .find((u) => !(eigene.ust_ids ?? []).map((x) => String(x).replace(/\s/g, '')).includes(u));
  if (ust) s.ust_id = ust;
  const st = treffer(/(?:steuer-?\s?(?:nummer|nr\.?)|st\.?-?nr\.?)\s*:?\s*(\d{2,3}\s?\/\s?\d{3,4}\s?\/\s?\d{4,5}|\d{10,13})/i, ganz);
  if (st && !(eigene.steuernummern ?? []).includes(st[1])) s.steuernr = st[1].replace(/\s/g, '');
  const hr = treffer(/\b(HR[ \t]?[AB])[ \t]*:?[ \t]*(\d{2,7}(?:[ \t]?[A-Z](?![a-zäöü]))?)\b/, ganz);
  const ag = treffer(/amtsgericht[ \t]+((?!HR[AB]\b)[A-ZÄÖÜ][\wäöüß\-]+(?:[ \t]+(?:(?!HR[AB]\b)[A-ZÄÖÜ][\wäöüß\-]+|am|an|der|i\.[ \t]?\w+\.?))*)/i, ganz);
  if (hr || ag) s.register = [hr && `${hr[1].replace(/\s/g, '')} ${hr[2]}`, ag && `Amtsgericht ${ag[1]}`].filter(Boolean).join(', ');
  const gf = treffer(/(geschäftsführ(?:er(?:in)?|ung)|inhaber(?:in)?|inh\.)\s*:?\s*([A-ZÄÖÜ][\wäöüß.\-]+(?:[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+){0,3}(?:,\s*[A-ZÄÖÜ][\wäöüß.\-]+(?:[ \t]+[A-ZÄÖÜ][\wäöüß.\-]+){0,3})*)/i, ganz);
  if (gf && !istEigen(gf[2])) s.inhaber = gf[2].trim();
  const tel = treffer(/(?:tel(?:efon)?\.?|fon|phone|☎)\s*:?\s*(\+?\d[\d \t/\-()]{5,20}\d)/i);
  if (tel) s.telefon = tel[1].replace(/\s{2,}/g, ' ').trim();
  const fax = treffer(/fax\.?\s*:?\s*(\+?\d[\d \t/\-()]{5,20}\d)/i);
  if (fax) s.fax = fax[1].trim();
  const mail = [...ganz.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase()).find((m) => !eigenMails.includes(m));
  if (mail) s.email = mail;
  const web = treffer(/\b((?:https?:\/\/)?www\.[\w-]+(?:\.[\w-]+)+|https?:\/\/[\w.-]+\.[a-z]{2,})/i);
  if (web) s.web = web[1].replace(/^https?:\/\//i, '');
  const bic = treffer(/\bBIC\s*:?\s*([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/, ganz);
  if (bic) s.bic = bic[1];
  const bank = fuss.flatMap(segmente).find((x) => /^(?:bank(?:verbindung)?\s*:?\s*)?[A-ZÄÖÜ]?[\wäöüß\- ]*(?:sparkasse|volksbank|raiffeisen|postbank|commerzbank|deutsche bank|targobank|hypovereinsbank|unicredit|ing\b|dkb|gls|kreissparkasse|stadtsparkasse|bank\b)[\wäöüß\- ]*$/i.test(x) && !/iban|bic/i.test(x));
  if (bank) s.bank = bank.replace(/^bank(?:verbindung)?\s*:?\s*/i, '').trim().slice(0, 60);
  // Recognition reads the 0 of the check digits as O now and then ("DEO2").
  const iban = treffer(/\b(DE[\dO]{2}(?:\s?\d{4}){4}\s?\d{2})\b/, ganz);
  const ibanN = iban ? iban[1].replace(/\s/g, '').replace(/^DE(..)/, (_, p) => `DE${p.replace(/O/g, '0')}`) : null;
  if (ibanN && !(eigene.ibans ?? []).map((x) => String(x).replace(/\s/g, '')).includes(ibanN)) s.iban = ibanN;

  // Name: a segment with a legal form, letterhead first, then the imprint; else the first line of the letterhead.
  const kandidaten = [...kopf, ...fuss].flatMap((z, i) => segmente(z).map((x) => ({ x, i })));
  const mitForm = kandidaten.find(({ x }) => RECHTSFORM.test(x) && !NICHT_NAME.test(x) && !istEigen(x) && x.length <= 80 && !PLZORT.test(x) && !STRASSE.test(x));
  const ersteZeile = kopf.slice(0, 6).flatMap(segmente).find((x) => x.length > 2 && !NICHT_NAME.test(x) && !istEigen(x) && !PLZORT.test(x) && !STRASSE.test(x) && /[a-zäöü]{2}/i.test(x) && !/@|www\./.test(x));
  const name = mitForm?.x ?? ersteZeile;
  if (name) s.name = name.replace(/[,:]\s*$/, '').slice(0, 80);

  // Address: the nearest street and postcode to the name that is not one of our own.
  const quellen = [...kopf.map((z, i) => ({ z, i, teil: 'kopf' })), ...fuss.map((z, i) => ({ z, i, teil: 'fuss' }))];
  const nameAt = name ? quellen.find((q) => q.z.includes(name)) : null;
  const nahe = nameAt ? [...quellen].sort((a, b) => (a.teil === nameAt.teil ? Math.abs(a.i - nameAt.i) : 99) - (b.teil === nameAt.teil ? Math.abs(b.i - nameAt.i) : 99)) : quellen;
  for (const q of nahe) {
    // Per segment ("Firma · Straße 1 · 12345 Ort"): the street before the postcode, else on the line above.
    const segs = segmente(q.z);
    const pi = segs.findIndex((x) => PLZORT.test(x));
    if (pi < 0) continue;
    const pl = PLZORT.exec(segs[pi]);
    const str = segs.slice(0, pi + 1).reverse().map((x) => STRASSE.exec(x)).find(Boolean)
      ?? segmente(quellen[quellen.indexOf(q) - 1]?.z ?? '').map((x) => STRASSE.exec(x)).find(Boolean);
    const adresse = `${str?.[1] ?? ''} ${pl[1]} ${pl[2]}`;
    if (istEigen(adresse) || (str && istEigen(str[1]))) continue;
    if (str) s.strasse = str[1].trim();
    s.plz = pl[1];
    s.ort = pl[2].trim();
    break;
  }
  return Object.keys(s).length ? s : null;
}

// Unit codes of e-invoices (UN/ECE Rec. 20) to plain words.
const EINHEITEN = { HUR: 'Std.', C62: 'Stk.', H87: 'Stk.', MON: 'Mon.', DAY: 'Tag', MTR: 'm', MTK: 'm²', MTQ: 'm³', KGM: 'kg', LTR: 'l', KMT: 'km', LS: 'pauschal', SET: 'Set', XPP: 'Stk.' };

// The same fields from an e-invoice (exact data).
function ausERechnung(er) {
  const v = er.verkaeufer ?? {};
  const steller = Object.fromEntries(Object.entries({ name: v.name, strasse: v.strasse, plz: v.plz, ort: v.ort, ust_id: v.ust_id, steuernr: v.steuernr, iban: er.iban })
    .filter(([, x]) => x != null && x !== ''));
  const steuer = (er.steuer ?? []).filter((t) => t.satz != null).map((t) => ({ satz: t.satz, netto_ct: t.basis_ct ?? 0, ust_ct: t.steuer_ct ?? 0 }));
  const positionen = (er.zeilen ?? []).map((z) => {
    const einheit = EINHEITEN[z.einheit] ?? z.einheit ?? null;
    return { text: z.text ?? '', menge: z.menge ?? null, einheit, betrag_ct: z.netto_ct ?? null, satz: z.satz ?? null, art: artVon(z.text ?? '', einheit) };
  });
  return { steller: Object.keys(steller).length ? steller : null, steuer: steuer.length ? steuer : null, positionen: positionen.length ? positionen : null,
    lohn_ct: lohnBerechnen(positionen, { brutto: er.brutto_ct ?? er.zahlbetrag_ct, netto: er.netto_ct }) };
}

// "Leistung: Heizungswartung, Dichtung, Anfahrt" – a short summary from the first items.
function kurztext(positionen) {
  const t = [...new Set((positionen ?? []).map((p) => p.text.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 40)).filter(Boolean))];
  return t.length ? `Leistung: ${t.slice(0, 4).join(', ')}${t.length > 4 ? ' …' : ''}` : null;
}

module.exports = { steuerErkennen, positionenErkennen, lohnBerechnen, stellerErkennen, ausERechnung, kurztext, artVon };
