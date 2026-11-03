// Tasks across all houses (the cases, vorgaenge): the board with its columns, status changes and comments kept in the
// case's history, and the daily reminder of tasks due tomorrow or overdue.
const ortszeit = require('./zeit.cjs');

const STATUS = { offen: 'Offen', in_arbeit: 'In Arbeit', wartet: 'Wartet', erledigt: 'Erledigt' };

module.exports = function aufgaben({ db, all, get, tx, PERSON_NAME }) {
  const name = (benutzerId) => (benutzerId ? get('SELECT name FROM benutzer WHERE id = ?', benutzerId)?.name : null) ?? null;
  const eintrag = (vorgangId, art, text, von) => db.prepare('INSERT INTO vorgangseintraege (vorgang_id, datum, art, text, von) VALUES (?, ?, ?, ?, ?)')
    .run(vorgangId, ortszeit.heute(), art, text, von);

  return {
    // The board: open tasks and those done in the last 14 days, with counts of comments and photos.
    aufgabenListe: (benutzerId, { nur_meine = false, objekt_id = null, zustaendig = null } = {}) => all(`SELECT v.*, ${PERSON_NAME} AS person,
        e.bezeichnung AS einheit, o.bezeichnung AS objekt, o.art AS objekt_art, b.name AS zustaendig_name,
        (SELECT count(*) FROM vorgangseintraege x WHERE x.vorgang_id = v.id AND x.art NOT IN ('status')) AS eintraege,
        (SELECT count(*) FROM dokumente d WHERE d.vorgang_id = v.id AND d.status <> 'papierkorb') AS fotos
      FROM vorgaenge v LEFT JOIN personen p ON p.id = v.person_id LEFT JOIN einheiten e ON e.id = v.einheit_id
      LEFT JOIN objekte o ON o.id = v.objekt_id LEFT JOIN benutzer b ON b.id = v.zustaendig
      WHERE (v.status <> 'erledigt' OR coalesce(v.geaendert_am, v.erstellt) >= ?1)
        AND (?2 = 0 OR v.zustaendig = ?3) AND (?4 IS NULL OR v.objekt_id = ?4) AND (?5 IS NULL OR v.zustaendig = ?5)
      ORDER BY v.prioritaet, coalesce(v.faellig, '9999'), v.id DESC`,
    new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), nur_meine && benutzerId ? 1 : 0, benutzerId ?? null, objekt_id ?? null, zustaendig ?? null),

    // Moves a task to another column; the history says who and when.
    vorgangStatus: (benutzerId, id, status) => tx(() => {
      if (!STATUS[status]) throw new Error('Unbekannter Status.');
      const v = get('SELECT status FROM vorgaenge WHERE id = ?', id);
      if (!v) throw new Error('Vorgang nicht gefunden');
      if (v.status === status) return false;
      db.prepare('UPDATE vorgaenge SET status = ? WHERE id = ?').run(status, id);
      eintrag(id, 'status', `${STATUS[v.status] ?? v.status} → ${STATUS[status]}`, name(benutzerId));
      return true;
    }),

    // A comment; the person in charge (if it is somebody else) gets a notification.
    vorgangKommentieren: (benutzerId, id, text) => tx(() => {
      const t = String(text ?? '').trim();
      if (!t) throw new Error('Bitte einen Text eingeben.');
      const v = get('SELECT id, titel, objekt_id, zustaendig FROM vorgaenge WHERE id = ?', id);
      if (!v) throw new Error('Vorgang nicht gefunden');
      const von = name(benutzerId);
      eintrag(id, 'kommentar', t.slice(0, 4000), von);
      return v.zustaendig && v.zustaendig !== benutzerId
        ? { benachrichtigen: { art: 'kommentar', benutzer: v.zustaendig, titel: `${von ?? 'Jemand'} hat „${v.titel}“ kommentiert`, text: t.slice(0, 160), ziel: { vorgang: v.id, objektId: v.objekt_id } } }
        : {};
    }),

    // Due tomorrow or overdue, assigned and not reminded today: each one once a day (marked here).
    faelligeErinnerungen: (heute = ortszeit.heute()) => tx(() => {
      const morgen = new Date(Date.parse(`${heute}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
      const liste = all(`SELECT v.id, v.titel, v.faellig, v.objekt_id, v.zustaendig, o.bezeichnung AS objekt FROM vorgaenge v LEFT JOIN objekte o ON o.id = v.objekt_id
        WHERE v.status <> 'erledigt' AND v.zustaendig IS NOT NULL AND v.faellig IS NOT NULL AND v.faellig <= ? AND coalesce(v.erinnert, '') <> ?`, morgen, heute);
      const st = db.prepare('UPDATE vorgaenge SET erinnert = ? WHERE id = ?');
      for (const v of liste) st.run(heute, v.id);
      return liste.map((v) => ({ art: 'faellig', benutzer: v.zustaendig, ziel: { vorgang: v.id, objektId: v.objekt_id },
        titel: v.faellig < heute ? `Überfällig: ${v.titel}` : v.faellig === heute ? `Heute fällig: ${v.titel}` : `Morgen fällig: ${v.titel}`,
        text: [v.objekt, `fällig ${v.faellig.split('-').reverse().join('.')}`].filter(Boolean).join(' · ') }));
    }),
  };
};
