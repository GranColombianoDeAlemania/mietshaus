// Notifications: Web Push to browsers and the home-screen app on iPhone/iPad (VAPID keys made on the first start, kept
// in the data folder), and the same note as an event for open windows – the Mac app shows it as a macOS notification.
// Kinds: postfach (new documents), aufgaben (a case assigned), morgen (morning overview), sicherung (backup problems).
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');

module.exports = function push({ daten, raw, senden }) {
  const datei = path.join(daten, 'vapid.json');
  let schluessel;
  try { schluessel = JSON.parse(fs.readFileSync(datei, 'utf8')); } catch {
    schluessel = webpush.generateVAPIDKeys();
    fs.writeFileSync(datei, JSON.stringify(schluessel), { mode: 0o600 });
  }
  webpush.setVapidDetails('mailto:mietshaus@localhost', schluessel.publicKey, schluessel.privateKey);
  const db = () => raw();

  return {
    oeffentlich: () => schluessel.publicKey,
    abonnieren: (benutzerId, abo, arten, geraet) => {
      if (!abo?.endpoint || !abo?.keys?.p256dh || !abo?.keys?.auth) throw new Error('Ungültiges Abonnement.');
      db().prepare(`INSERT INTO push_abos (benutzer_id, endpoint, schluessel, arten, geraet) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET benutzer_id = excluded.benutzer_id, schluessel = excluded.schluessel, arten = excluded.arten, geraet = excluded.geraet`)
        .run(benutzerId, abo.endpoint, JSON.stringify(abo.keys), (arten ?? []).join(','), geraet ?? null);
    },
    abbestellen: (endpoint) => db().prepare('DELETE FROM push_abos WHERE endpoint = ?').run(String(endpoint)),
    abo: (endpoint) => db().prepare('SELECT arten FROM push_abos WHERE endpoint = ?').get(String(endpoint)) ?? null,
    // n: { art, titel, text, url, benutzer (only this user; null = everybody) }. Returns the number of pushes sent.
    benachrichtigen: async (n) => {
      senden('benachrichtigung', { art: n.art, titel: n.titel, text: n.text, url: n.url ?? '/', benutzer: n.benutzer ?? null });
      // A test goes to every device of the user, whatever kinds it chose.
      const abos = db().prepare(`SELECT * FROM push_abos WHERE (?1 IS NULL OR benutzer_id = ?1) AND (?2 = 'test' OR (',' || arten || ',') LIKE '%,' || ?2 || ',%')`).all(n.benutzer ?? null, n.art);
      let gesendet = 0;
      for (const a of abos) {
        try {
          await webpush.sendNotification({ endpoint: a.endpoint, keys: JSON.parse(a.schluessel) },
            JSON.stringify({ art: n.art, titel: n.titel, text: n.text, url: n.url ?? '/' }), { TTL: 24 * 3600 });
          gesendet++;
        } catch (e) {
          // The browser gave the subscription up (app removed, permission withdrawn): forget it.
          if (e?.statusCode === 404 || e?.statusCode === 410) db().prepare('DELETE FROM push_abos WHERE id = ?').run(a.id);
          else console.error('Push', e?.statusCode ?? '', e?.body ?? e?.message ?? e);
        }
      }
      return gesendet;
    },
  };
};
