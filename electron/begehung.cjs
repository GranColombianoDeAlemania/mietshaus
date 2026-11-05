// Inspection of a house on the phone: area by area (stairwell, cellar, roof … and the units) with state, photos and
// notes. A defect becomes a case with its photos; due duties of the house show up as check points in their area.
// Completed, the inspection is a PDF protocol in the archive.
const ortszeit = require('./zeit.cjs');
const { zustand: pflichtZustand } = require('./pflichten.cjs');

const BEREICHE = ['Treppenhaus', 'Keller', 'Heizraum', 'Dach & Dachrinnen', 'Fassade & Fenster', 'Außenanlage & Wege', 'Müllplatz', 'Briefkästen & Klingeln'];
// Where a duty is checked on the round.
const PFLICHT_BEREICH = {
  heizung: 'Heizraum', legionellen: 'Heizraum', gas: 'Keller', echeck: 'Keller', rueckstau: 'Keller', feuerloescher: 'Treppenhaus',
  aufzug: 'Treppenhaus', rauchmelder: 'Treppenhaus', dachrinne: 'Dach & Dachrinnen', schornstein: 'Dach & Dachrinnen',
  baum: 'Außenanlage & Wege', spielplatz: 'Außenanlage & Wege', winterdienst: 'Außenanlage & Wege',
};
const datumDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

const parse = (b) => (b ? { ...b, bereiche: JSON.parse(b.bereiche || '[]') } : null);

module.exports = function begehung({ db, all, get, tx, ablaufStarten }) {
  return {
    begehungen: (objektId) => all(`SELECT id, datum, teilnehmer, abgeschlossen, dokument_id, bereiche FROM begehungen WHERE objekt_id = ? ORDER BY datum DESC, id DESC`, objektId)
      .map((b) => {
        const bereiche = JSON.parse(b.bereiche || '[]');
        return { ...b, bereiche: undefined, anzahl: bereiche.length, geprueft: bereiche.filter((x) => x.zustand).length, maengel: bereiche.reduce((s, x) => s + (x.maengel?.length ?? 0), 0) };
      }),

    // A new round, pre-filled with the usual areas, the units and the duties that are due (or overdue, or without a date).
    begehungNeu: ({ objekt_id, datum = ortszeit.heute(), teilnehmer = null }) => {
      if (!get('SELECT 1 FROM objekte WHERE id = ?', objekt_id)) throw new Error('Bitte ein Objekt wählen.');
      const t = ortszeit.heute();
      const bereiche = BEREICHE.map((name) => ({ name, zustand: '', notiz: '', fotos: [], maengel: [], pruefpunkte: [] }));
      for (const e of all('SELECT id, bezeichnung FROM einheiten WHERE objekt_id = ? ORDER BY nr', objekt_id))
        bereiche.push({ name: e.bezeichnung, einheit_id: e.id, zustand: '', notiz: '', fotos: [], maengel: [], pruefpunkte: [] });
      for (const p of all('SELECT * FROM pflichten WHERE objekt_id = ? AND aktiv = 1', objekt_id)) {
        const z = pflichtZustand(p, t);
        if (z === 'ok' || z === 'pausiert') continue;
        const ziel = (p.einheit_id && bereiche.find((b) => b.einheit_id === p.einheit_id)) || bereiche.find((b) => b.name === PFLICHT_BEREICH[p.art]) || bereiche[0];
        ziel.pruefpunkte.push({ pflicht_id: p.id, titel: p.titel, naechste: p.naechste });
      }
      return Number(db.prepare('INSERT INTO begehungen (objekt_id, datum, teilnehmer, bereiche) VALUES (?, ?, ?, ?)')
        .run(objekt_id, datum, teilnehmer, JSON.stringify(bereiche)).lastInsertRowid);
    },

    begehung: (id) => {
      const b = parse(get('SELECT * FROM begehungen WHERE id = ?', id));
      if (!b) return null;
      const o = get('SELECT id, bezeichnung, strasse, plz, ort FROM objekte WHERE id = ?', b.objekt_id);
      // Check points done meanwhile (from the duty itself) are shown as done.
      for (const x of b.bereiche) for (const p of x.pruefpunkte ?? []) {
        const f = get('SELECT naechste FROM pflichten WHERE id = ?', p.pflicht_id);
        p.erledigt = !f || (f.naechste ?? '') !== (p.naechste ?? '');
      }
      return { ...b, objekt: o };
    },

    // Saves the round while it is open; a completed protocol stays as it was.
    begehungSpeichern: (b) => {
      const r = db.prepare(`UPDATE begehungen SET datum = ?, teilnehmer = ?, bereiche = ?, notiz = ? WHERE id = ? AND abgeschlossen = 0`)
        .run(b.datum, b.teilnehmer ?? null, JSON.stringify(b.bereiche ?? []), b.notiz ?? null, b.id);
      if (!r.changes) throw new Error('Diese Begehung ist abgeschlossen und kann nicht mehr geändert werden.');
      return true;
    },

    // A defect: a case for the house (and unit) with the chosen photos – or a whole damage workflow – noted in the area.
    begehungMangel: (id, index, { text, foto_ids = [], prioritaet = 2, ablauf = false } = {}) => tx(() => {
      const b = parse(get('SELECT * FROM begehungen WHERE id = ?', id));
      if (!b) throw new Error('Diese Begehung gibt es nicht mehr.');
      if (b.abgeschlossen) throw new Error('Diese Begehung ist abgeschlossen.');
      const bereich = b.bereiche[index];
      if (!bereich) throw new Error('Diesen Bereich gibt es nicht.');
      const t = String(text ?? '').trim();
      if (!t) throw new Error('Bitte den Mangel kurz beschreiben.');
      const beschreibung = `Bei der Begehung am ${datumDe(b.datum)} festgestellt – ${bereich.name}.`;
      let vorgangId;
      const schaden = ablauf ? get(`SELECT id FROM ablaeufe WHERE art = 'schaden'`) : null;
      if (schaden) vorgangId = ablaufStarten(schaden.id, { objekt_id: b.objekt_id, einheit_id: bereich.einheit_id ?? null, stichtag: ortszeit.heute(), titel: t.slice(0, 200) });
      else vorgangId = Number(db.prepare(`INSERT INTO vorgaenge (objekt_id, einheit_id, titel, kategorie, status, prioritaet, faellig, beschreibung)
        VALUES (?, ?, ?, 'mangel', 'offen', ?, NULL, ?)`).run(b.objekt_id, bereich.einheit_id ?? null, t.slice(0, 200), Number(prioritaet) || 2, beschreibung).lastInsertRowid);
      if (schaden) db.prepare('UPDATE vorgaenge SET beschreibung = coalesce(beschreibung, \'\') || ? WHERE id = ?').run(`\n${beschreibung}`, vorgangId);
      const fotos = (foto_ids ?? []).map(Number).filter(Boolean);
      for (const f of fotos) db.prepare('UPDATE dokumente SET vorgang_id = ? WHERE id = ?').run(vorgangId, f);
      bereich.zustand = 'maengel';
      bereich.maengel = [...(bereich.maengel ?? []), { text: t, vorgang_id: vorgangId, foto_ids: fotos }];
      db.prepare('UPDATE begehungen SET bereiche = ? WHERE id = ?').run(JSON.stringify(b.bereiche), id);
      return vorgangId;
    }),

    begehungAbschliessen: (id, dokumentId) => {
      db.prepare('UPDATE begehungen SET abgeschlossen = 1, dokument_id = ? WHERE id = ?').run(dokumentId ?? null, id);
      return true;
    },
  };
};

Object.assign(module.exports, { BEREICHE, PFLICHT_BEREICH });
