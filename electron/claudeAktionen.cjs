// Claude's actions that move money or change contracts and bank details. With approval switched on (the default),
// the MCP server only stores them as proposals; the app shows each one in plain words and runs it once the user
// accepts. A forged invoice in the inbox can therefore not book or redirect anything on its own.
// Each action: beschreiben(db, args) → one line for the user, ausfuehren(db, args) → result text for Claude.
const cent = (eur) => (eur == null ? null : Math.round(Number(eur) * 100));
const euro = (ct) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format((ct ?? 0) / 100);
const datumDe = (iso) => (iso ? String(iso).split('-').reverse().join('.') : '');
const konto = (db, id) => { const k = id ? db.get('konten', id) : null; return k ? `${k.nr} ${k.bezeichnung}` : `Konto ${id ?? '?'}`; };
const objekt = (db, id) => db.get('objekte', id)?.bezeichnung ?? `Objekt ${id}`;
const person = (db, id) => { const p = id ? db.get('personen', id) : null; return p ? [p.firma, [p.vorname, p.nachname].filter(Boolean).join(' ')].filter(Boolean).join(', ') : `Person ${id ?? '?'}`; };
const einheit = (db, id) => { const e = id ? db.get('einheiten', id) : null; return e ? `${e.bezeichnung} (${objekt(db, e.objekt_id)})` : `Einheit ${id ?? '?'}`; };

function rechnungVorbereiten(db, a) {
  const d = db.dokument(a.dokument_id);
  if (!d) throw new Error('Dokument nicht gefunden');
  if (!d.objekt_id) throw new Error('Dem Dokument ist noch kein Objekt zugeordnet (dokument_ablegen mit objekt_id).');
  if (d.buchung_id) throw new Error('Dieses Dokument ist bereits gebucht.');
  const geld = a.geld_konto_id ?? db.konten(d.objekt_id, 'geld')[0]?.id;
  const betrag = cent(a.betrag_eur) ?? d.betrag_ct;
  if (!betrag) throw new Error('Kein Betrag bekannt.');
  return { d, geld, betrag };
}

const AKTIONEN = {
  rechnung_buchen: {
    beschreiben: (db, a) => {
      const { d, geld, betrag } = rechnungVorbereiten(db, a);
      return `${d.typ === 'Gutschrift' ? 'Gutschrift' : 'Rechnung'} „${[d.absender, d.titel].filter(Boolean).join(' – ')}“ über ${euro(betrag)} buchen: `
        + `${konto(db, a.kosten_konto_id)} an ${konto(db, geld)}, Datum ${datumDe(a.datum ?? d.datum)} (${objekt(db, d.objekt_id)}).`;
    },
    ausfuehren: (db, a) => {
      const { d, geld, betrag } = rechnungVorbereiten(db, a);
      const gutschrift = d.typ === 'Gutschrift';
      // Input tax: only with an exact VAT amount (e-invoice) and a VAT-able letting in the house; mixed houses deduct their share.
      const vst = db.konten(d.objekt_id).find((k) => k.klasse === 'steuer' && k.kategorie === 'vorsteuer19');
      const quote = db.get('objekte', d.objekt_id)?.vorsteuer_quote ?? 100;
      const abziehbar = vst && d.ust_ct && (a.vorsteuer_abziehen ?? true) && betrag === d.betrag_ct ? Math.round(d.ust_ct * quote / 100) : 0;
      const pos = [{ konto: a.kosten_konto_id, ct: betrag - abziehbar }, ...(abziehbar ? [{ konto: vst.id, ct: abziehbar }] : [])];
      const id = db.buchen({ objekt_id: d.objekt_id, datum: a.datum ?? d.datum, beleg: d.rechnungsnr, text: (a.text ?? [d.absender, d.titel].filter(Boolean).join(' – ')).slice(0, 120),
        einheit_id: a.einheit_id ?? d.einheit_id ?? null,
        positionen: pos.map((p) => (gutschrift ? { soll_id: geld, haben_id: p.konto, betrag_ct: p.ct } : { soll_id: p.konto, haben_id: geld, betrag_ct: p.ct })) });
      db.dokumentSpeichern({ id: d.id, buchung_id: id, status: 'abgelegt' });
      return `Gebucht (Buchung ${id})${abziehbar ? `, davon ${(abziehbar / 100).toFixed(2)} € Vorsteuer` : ''}, Beleg verknüpft.`;
    },
  },

  buchen: {
    beschreiben: (db, a) => `Buchung „${a.text}“ vom ${datumDe(a.datum)} (${objekt(db, a.objekt_id)}): `
      + a.positionen.map((p) => `${konto(db, p.soll_konto_id)} an ${konto(db, p.haben_konto_id)} ${euro(cent(p.betrag_eur))}`).join('; ') + '.',
    ausfuehren: (db, a) => {
      const id = db.buchen({ objekt_id: a.objekt_id, datum: a.datum, text: a.text, beleg: a.beleg, einheit_id: a.einheit_id ?? null,
        positionen: a.positionen.map((p) => ({ soll_id: p.soll_konto_id, haben_id: p.haben_konto_id, betrag_ct: cent(p.betrag_eur), text: p.text })) });
      if (a.dokument_id) db.dokumentSpeichern({ id: a.dokument_id, buchung_id: id });
      return `Gebucht (Buchung ${id}).`;
    },
  },

  // Bank details decide where money goes: changes to a person need approval, too.
  person_aendern: {
    beschreiben: (db, a) => {
      const vorher = db.get('personen', a.id) ?? {};
      const felder = Object.entries(a).filter(([k]) => k !== 'id').map(([k, v]) => `${k}: ${vorher[k] ?? '–'} → ${v ?? '–'}`);
      return `${person(db, a.id)} ändern – ${felder.join(', ')}.`;
    },
    ausfuehren: (db, a) => `Person ${db.save('personen', a)} aktualisiert.`,
  },

  mietvertrag_anlegen: {
    beschreiben: (db, a) => `Mietvertrag ${person(db, a.person_id)} für ${einheit(db, a.einheit_id)} ab ${datumDe(a.beginn)}${a.ende ? ` bis ${datumDe(a.ende)}` : ''}: `
      + `Kaltmiete ${euro(cent(a.kaltmiete_eur))}, Betriebskosten ${euro(cent(a.bk_vz_eur ?? 0))} (${a.betriebskosten ?? 'vorauszahlung'}), Heizkosten ${euro(cent(a.hk_vz_eur ?? 0))}`
      + `${a.kaution_eur ? `, Kaution ${euro(cent(a.kaution_eur))}` : ''}.`,
    ausfuehren: (db, a) => `Mietverhältnis angelegt, id ${db.save('mietverhaeltnisse', {
      einheit_id: a.einheit_id, person_id: a.person_id, person2_id: a.person2_id, beginn: a.beginn, ende: a.ende,
      kaltmiete_ct: cent(a.kaltmiete_eur), bk_vz_ct: cent(a.bk_vz_eur ?? 0), hk_vz_ct: cent(a.hk_vz_eur ?? 0), sonstiges_ct: cent(a.sonstiges_eur ?? 0),
      kaution_ct: cent(a.kaution_eur ?? 0), personen_anzahl: a.personen_anzahl ?? 1, faelligkeitstag: a.faelligkeitstag ?? 3,
      bk_art: a.betriebskosten ?? 'vorauszahlung', mietmonat_ab: a.mietmonat_ab ?? 'erster', teilmonat_beginn: a.einzugsmonat ?? 'voll', teilmonat_ende: a.auszugsmonat ?? 'voll',
      teilbetrag_beginn_ct: a.teilbetrag_eur ? cent(a.teilbetrag_eur) : null, bk_abrechnung: a.abrechnung_nach ?? 'mietmonate' })}.`,
  },

  eigentum_anlegen: {
    beschreiben: (db, a) => `Eigentum ${person(db, a.person_id)} an ${einheit(db, a.einheit_id)} ab ${datumDe(a.beginn)}: Hausgeld ${euro(cent(a.hausgeld_eur ?? 0))}, `
      + `Rücklage ${euro(cent(a.ruecklage_eur ?? 0))}${a.selbstnutzer ? ', selbst genutzt' : ''}.`,
    ausfuehren: (db, a) => `Eigentum angelegt, id ${db.save('eigentum', { einheit_id: a.einheit_id, person_id: a.person_id, beginn: a.beginn, ende: a.ende,
      hausgeld_ct: cent(a.hausgeld_eur ?? 0), ruecklage_ct: cent(a.ruecklage_eur ?? 0), selbstnutzer: a.selbstnutzer ? 1 : 0 })}.`,
  },

  vertrag_beenden: {
    beschreiben: (db, a) => {
      const v = db.get(a.art === 'weg' ? 'eigentum' : 'mietverhaeltnisse', a.vertrag_id);
      return `${a.art === 'weg' ? 'Eigentum' : 'Mietverhältnis'} ${v ? `${person(db, v.person_id)}, ${einheit(db, v.einheit_id)}` : a.vertrag_id} endet am ${datumDe(a.ende)}.`;
    },
    ausfuehren: (db, a) => `Vertrag ${db.save(a.art === 'weg' ? 'eigentum' : 'mietverhaeltnisse', { id: a.vertrag_id, ende: a.ende })} endet am ${a.ende}.`,
  },

  weg_kosten_uebernehmen: {
    beschreiben: (db, a) => `Umlagefähige Kosten aus der WEG-Abrechnung ${a.jahr} umbuchen (${objekt(db, a.objekt_id)}): `
      + a.positionen.map((p) => `${konto(db, p.kosten_konto_id)} ${euro(cent(p.betrag_eur))}`).join('; ') + '.',
    ausfuehren: (db, a) => `Umgebucht (Buchung ${db.wegKostenUebernehmen(a.objekt_id, `${a.jahr}-12-31`,
      a.positionen.map((p) => ({ konto_id: p.kosten_konto_id, betrag_ct: cent(p.betrag_eur), text: p.text })), `Umlagefähige Kosten aus WEG-Abrechnung ${a.jahr}`)}).`,
  },
};

module.exports = { AKTIONEN };
