// Workflow templates: a tenant change, a damage, the service-charge statement, a new letting – each a list of steps
// with days before or after a key date (the move-out, the report …). Started for a house (and unit or person), the
// template becomes a case on the board with its steps as sub-cases, each with its due date.
const ortszeit = require('./zeit.cjs');

const plusTage = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const datumDe = (iso) => (iso ? iso.split('-').reverse().join('.') : '');

// Steps as stored: [{ tage, titel }], sorted by day; invalid entries are dropped.
function schritteLesen(json) {
  let s = [];
  try { s = JSON.parse(json ?? '[]'); } catch {}
  return (Array.isArray(s) ? s : []).filter((x) => x && String(x.titel ?? '').trim() && Number.isFinite(Number(x.tage)))
    .map((x) => ({ tage: Math.round(Number(x.tage)), titel: String(x.titel).trim().slice(0, 200) })).sort((a, b) => a.tage - b.tage);
}

module.exports = function ablaeufe({ db, all, get, tx }) {
  return {
    ablaeufe: () => all('SELECT * FROM ablaeufe ORDER BY titel').map((a) => ({ ...a, schritte: schritteLesen(a.schritte) })),

    // Starts a template: the main case (due on the last step) and one sub-case per step. Steps whose day has already
    // passed are due today. { objekt_id, einheit_id?, person_id?, stichtag, zustaendig?, titel? } → id of the main case.
    ablaufStarten: (ablaufId, { objekt_id, einheit_id = null, person_id = null, stichtag, zustaendig = null, titel = null } = {}) => tx(() => {
      const a = get('SELECT * FROM ablaeufe WHERE id = ?', ablaufId);
      if (!a) throw new Error('Diese Vorlage gibt es nicht mehr.');
      if (!objekt_id) throw new Error('Bitte ein Objekt wählen.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stichtag ?? '')) throw new Error(`Bitte das Datum „${a.anlass ?? 'Stichtag'}“ angeben.`);
      const schritte = schritteLesen(a.schritte);
      if (!schritte.length) throw new Error('Die Vorlage hat noch keine Schritte.');
      const t = ortszeit.heute();
      const faellig = (tage) => { const d = plusTage(stichtag, tage); return d < t ? t : d; };
      const zu = [
        get('SELECT bezeichnung FROM einheiten WHERE id = ?', einheit_id)?.bezeichnung,
        get(`SELECT trim(coalesce(nachname, '') || ' ' || coalesce(firma, '')) AS n FROM personen WHERE id = ?`, person_id)?.n,
      ].filter(Boolean).join(', ');
      const ins = db.prepare(`INSERT INTO vorgaenge (objekt_id, einheit_id, person_id, titel, kategorie, status, prioritaet, faellig, beschreibung, zustaendig, eltern_id)
        VALUES (?, ?, ?, ?, ?, 'offen', 2, ?, ?, ?, ?)`);
      const haupt = Number(ins.run(objekt_id, einheit_id, person_id, titel || `${a.titel}${zu ? `: ${zu}` : ''}`, 'ablauf',
        faellig(schritte[schritte.length - 1].tage), `${a.anlass ?? 'Stichtag'} ${datumDe(stichtag)} – Ablauf „${a.titel}“ mit ${schritte.length} Schritten.`,
        zustaendig, null).lastInsertRowid);
      for (const s of schritte) ins.run(objekt_id, einheit_id, person_id, s.titel, 'ablauf', faellig(s.tage), null, zustaendig, haupt);
      return haupt;
    }),

    // The steps of a started workflow with their state (shown with the main case).
    ablaufSchritte: (hauptId) => all(`SELECT id, titel, status, faellig, zustaendig FROM vorgaenge WHERE eltern_id = ? ORDER BY coalesce(faellig, '9999'), id`, hauptId),
  };
};

Object.assign(module.exports, { schritteLesen });
