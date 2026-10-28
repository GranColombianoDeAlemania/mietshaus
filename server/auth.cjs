// Users, passwords and sessions of the Mietshaus server. Passwords are stored as scrypt hashes; a session is a random
// token in an HttpOnly cookie, of which only the SHA-256 is kept in the database. Claude gets a token of its own per user.
const crypto = require('node:crypto');

const SITZUNG_TAGE = 30;
const EINLADUNG_TAGE = 14;
// A user invited but not yet active has no password: nobody can log in with it.
const KEIN_PASSWORT = '!';
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const jetzt = () => new Date().toISOString();

function hashen(passwort) {
  const salz = crypto.randomBytes(16);
  const h = crypto.scryptSync(passwort, salz, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$15$${salz.toString('base64')}$${h.toString('base64')}`;
}

function passt(passwort, gespeichert) {
  const [art, n, salz, hash] = String(gespeichert ?? '').split('$');
  if (art !== 'scrypt') return false;
  const soll = Buffer.from(hash, 'base64');
  const ist = crypto.scryptSync(passwort, Buffer.from(salz, 'base64'), soll.length, { N: 2 ** Number(n), r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(soll, ist);
}

// Too many wrong passwords from one address: wait a while (5 tries, then 1 minute, doubling up to an hour).
function bremse() {
  const fehl = new Map();
  return {
    gesperrt: (ip) => { const f = fehl.get(ip); return f && f.bis > Date.now() ? Math.ceil((f.bis - Date.now()) / 1000) : 0; },
    fehler: (ip) => {
      const f = fehl.get(ip) ?? { n: 0, bis: 0 };
      f.n++;
      if (f.n >= 5) f.bis = Date.now() + Math.min(3600_000, 60_000 * 2 ** (f.n - 5));
      fehl.set(ip, f);
    },
    erfolg: (ip) => fehl.delete(ip),
  };
}

module.exports = function auth(rawDb) {
  const db = () => rawDb();
  const pruefePasswort = (p) => {
    if (typeof p !== 'string' || p.length < 10) throw new Error('Das Passwort braucht mindestens 10 Zeichen.');
  };
  const oeffentlich = (b) => b && { id: b.id, login: b.login, name: b.name, aktiv: !!b.aktiv, claude: !!b.claude_token_hash, erstellt: b.erstellt,
    eingeladen: b.passwort_hash === KEIN_PASSWORT, einladung_bis: b.einladung_bis ?? null };
  const einladung = (id) => {
    const token = crypto.randomBytes(24).toString('base64url');
    const bis = new Date(Date.now() + EINLADUNG_TAGE * 864e5).toISOString();
    db().prepare('UPDATE benutzer SET einladung_hash = ?, einladung_bis = ? WHERE id = ?').run(sha(token), bis, id);
    return { token, bis };
  };

  return {
    anzahl: () => db().prepare('SELECT count(*) AS n FROM benutzer').get().n,
    benutzer: (id) => oeffentlich(db().prepare('SELECT * FROM benutzer WHERE id = ? AND aktiv = 1').get(id)),
    liste: () => db().prepare('SELECT * FROM benutzer ORDER BY name').all().map(oeffentlich),
    anlegen: ({ login, name, passwort }) => {
      if (!/^[a-z0-9._-]{2,40}$/i.test(login ?? '')) throw new Error('Der Login darf nur Buchstaben, Ziffern, Punkt, Minus und Unterstrich enthalten (2–40 Zeichen).');
      pruefePasswort(passwort);
      if (db().prepare('SELECT 1 FROM benutzer WHERE login = ?').get(login)) throw new Error('Diesen Login gibt es schon.');
      const r = db().prepare('INSERT INTO benutzer (login, name, passwort_hash) VALUES (?, ?, ?)').run(login, (name || login).trim(), hashen(passwort));
      return Number(r.lastInsertRowid);
    },
    aendern: (id, { name, passwort, aktiv }) => {
      if (passwort !== undefined) {
        pruefePasswort(passwort);
        db().prepare('UPDATE benutzer SET passwort_hash = ? WHERE id = ?').run(hashen(passwort), id);
        db().prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(id);
      }
      if (name !== undefined) db().prepare('UPDATE benutzer SET name = ? WHERE id = ?').run(String(name).trim(), id);
      if (aktiv !== undefined) {
        if (!aktiv && db().prepare('SELECT count(*) AS n FROM benutzer WHERE aktiv = 1 AND id <> ?').get(id).n === 0)
          throw new Error('Mindestens ein Benutzer muss aktiv bleiben.');
        db().prepare('UPDATE benutzer SET aktiv = ? WHERE id = ?').run(aktiv ? 1 : 0, id);
        if (!aktiv) db().prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(id);
      }
    },
    // Returns the user for a correct login and password, else null.
    anmelden: (login, passwort) => {
      const b = db().prepare('SELECT * FROM benutzer WHERE login = ? AND aktiv = 1').get(String(login ?? ''));
      if (!b) { hashen('gleich lange rechnen'); return null; }
      return passt(String(passwort ?? ''), b.passwort_hash) ? oeffentlich(b) : null;
    },
    sitzungAnlegen: (benutzerId, geraet) => {
      const token = crypto.randomBytes(32).toString('base64url');
      db().prepare('INSERT INTO sitzungen (token_hash, benutzer_id, erstellt, zuletzt, geraet) VALUES (?, ?, ?, ?, ?)').run(sha(token), benutzerId, jetzt(), jetzt(), geraet ?? null);
      return token;
    },
    sitzungBeenden: (token) => db().prepare('DELETE FROM sitzungen WHERE token_hash = ?').run(sha(String(token ?? ''))),
    // The user behind a session token (sliding expiry of 30 days), or null.
    sitzung: (token) => {
      if (!token) return null;
      const grenze = new Date(Date.now() - SITZUNG_TAGE * 864e5).toISOString();
      const s = db().prepare(`SELECT b.* FROM sitzungen s JOIN benutzer b ON b.id = s.benutzer_id WHERE s.token_hash = ? AND s.zuletzt >= ? AND b.aktiv = 1`).get(sha(token), grenze);
      if (!s) return null;
      db().prepare('UPDATE sitzungen SET zuletzt = ? WHERE token_hash = ?').run(jetzt(), sha(token));
      return oeffentlich(s);
    },
    // A new Claude token for a user (shown once); the old one stops working.
    claudeToken: (benutzerId) => {
      const token = `mh_${crypto.randomBytes(32).toString('base64url')}`;
      db().prepare('UPDATE benutzer SET claude_token_hash = ? WHERE id = ?').run(sha(token), benutzerId);
      return token;
    },
    claudeBenutzer: (token) => {
      if (!token) return null;
      return oeffentlich(db().prepare('SELECT * FROM benutzer WHERE claude_token_hash = ? AND aktiv = 1').get(sha(token)));
    },
    // Invites a new person: a user without password plus a one-time link. Returns { id, token, bis }.
    einladen: ({ login, name }) => {
      if (!/^[a-z0-9._-]{2,40}$/i.test(login ?? '')) throw new Error('Der Benutzername darf nur Buchstaben, Ziffern, Punkt, Minus und Unterstrich enthalten (2–40 Zeichen).');
      if (db().prepare('SELECT 1 FROM benutzer WHERE login = ?').get(login)) throw new Error('Diesen Benutzernamen gibt es schon.');
      const id = Number(db().prepare('INSERT INTO benutzer (login, name, passwort_hash) VALUES (?, ?, ?)').run(login, (name || login).trim(), KEIN_PASSWORT).lastInsertRowid);
      return { id, ...einladung(id) };
    },
    // A new link for an existing user (lost invitation, forgotten password). The old link stops working.
    einladungErneuern: (id) => {
      if (!db().prepare('SELECT 1 FROM benutzer WHERE id = ?').get(id)) throw new Error('Benutzer nicht gefunden.');
      return einladung(id);
    },
    einladungPruefen: (token) => {
      const b = db().prepare('SELECT * FROM benutzer WHERE einladung_hash = ? AND einladung_bis >= ? AND aktiv = 1').get(sha(String(token ?? '')), jetzt());
      return b ? { login: b.login, name: b.name, neu: b.passwort_hash === KEIN_PASSWORT } : null;
    },
    // Sets the password with the link; the link is used up and other sessions of the user end. Returns the user.
    einladungEinloesen: (token, passwort) => {
      pruefePasswort(passwort);
      const b = db().prepare('SELECT * FROM benutzer WHERE einladung_hash = ? AND einladung_bis >= ? AND aktiv = 1').get(sha(String(token ?? '')), jetzt());
      if (!b) throw new Error('Diese Einladung ist abgelaufen oder wurde schon benutzt. Bitte eine neue anfordern.');
      db().prepare('UPDATE benutzer SET passwort_hash = ?, einladung_hash = NULL, einladung_bis = NULL WHERE id = ?').run(hashen(passwort), b.id);
      db().prepare('DELETE FROM sitzungen WHERE benutzer_id = ?').run(b.id);
      return oeffentlich(b);
    },
    // Signed-in devices: an id (start of the token hash), user, device (browser) and last use.
    sitzungen: (eigenesToken) => db().prepare(`SELECT substr(s.token_hash, 1, 16) AS id, s.token_hash = ? AS eigene, s.erstellt, s.zuletzt, s.geraet, b.name
        FROM sitzungen s JOIN benutzer b ON b.id = s.benutzer_id ORDER BY s.zuletzt DESC`).all(sha(String(eigenesToken ?? ''))).map((x) => ({ ...x, eigene: !!x.eigene })),
    sitzungBeendenId: (id) => db().prepare(`DELETE FROM sitzungen WHERE substr(token_hash, 1, 16) = ?`).run(String(id)),
    bremse: bremse(),
  };
};
module.exports.sha = sha;
