// The notification bell: every notification is also kept here, per recipient (all active users when it is meant for
// everybody; without users – the Mac app on its own – once). The morning overview and test pushes stay push-only.
const NUR_PUSH = new Set(['morgen', 'test']);

module.exports = function mitteilungen({ db, all, get, tx }) {
  const jetzt = () => new Date().toISOString();
  return {
    // n: { art, titel, text, ziel (a navigation target), benutzer (only this user) }. Returns the number of rows.
    mitteilungAnlegen: (n) => tx(() => {
      if (!n?.art || NUR_PUSH.has(n.art)) return 0;
      const nutzer = n.benutzer != null ? [n.benutzer] : all('SELECT id FROM benutzer WHERE aktiv = 1').map((b) => b.id);
      const empfaenger = nutzer.length ? nutzer : [null];
      const st = db.prepare('INSERT INTO mitteilungen (benutzer_id, art, titel, text, ziel, erstellt) VALUES (?, ?, ?, ?, ?, ?)');
      for (const b of empfaenger) st.run(b, n.art, String(n.titel ?? '').slice(0, 200), n.text ? String(n.text).slice(0, 500) : null, n.ziel ? JSON.stringify(n.ziel) : null, jetzt());
      db.prepare(`DELETE FROM mitteilungen WHERE erstellt < ?`).run(new Date(Date.now() - 90 * 864e5).toISOString());
      return empfaenger.length;
    }),
    mitteilungen: (benutzerId, limit = 50) => all(`SELECT * FROM mitteilungen WHERE benutzer_id IS ? ORDER BY id DESC LIMIT ?`, benutzerId ?? null, limit)
      .map((m) => ({ ...m, ziel: m.ziel ? JSON.parse(m.ziel) : null })),
    mitteilungenUngelesen: (benutzerId) => get(`SELECT count(*) AS n FROM mitteilungen WHERE benutzer_id IS ? AND gelesen IS NULL`, benutzerId ?? null).n,
    mitteilungGelesen: (benutzerId, id) => { db.prepare(`UPDATE mitteilungen SET gelesen = ? WHERE id = ? AND benutzer_id IS ? AND gelesen IS NULL`).run(jetzt(), id, benutzerId ?? null); },
    alleMitteilungenGelesen: (benutzerId) => db.prepare(`UPDATE mitteilungen SET gelesen = ? WHERE benutzer_id IS ? AND gelesen IS NULL`).run(jetzt(), benutzerId ?? null).changes,
  };
};
