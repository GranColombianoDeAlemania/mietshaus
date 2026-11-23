// Jago, the helper in the app. Ideas and faults are kept together with what was going on (page, version, device, the
// last error messages), so they can be worked on later. Questions find their help topic. No AI: the words of the
// question against a fixed list of topics with their synonyms (jagohilfe.cjs), all on this server.
const { VERSION } = require('./version.cjs');
const THEMEN = require('./jagohilfe.cjs');

const falten = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
// Words that say nothing about the topic.
const FUELL = new Set(['wie', 'wo', 'was', 'wann', 'warum', 'wieso', 'welche', 'welcher', 'welches', 'kann', 'koennen', 'ich', 'man', 'mache', 'macht',
  'machen', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'und', 'oder', 'mit', 'fuer', 'von', 'vom', 'zu', 'zum',
  'zur', 'im', 'in', 'auf', 'an', 'am', 'ist', 'sind', 'wird', 'werden', 'bei', 'mein', 'meine', 'meinen', 'meiner', 'geht', 'gehe', 'soll', 'sollte',
  'muss', 'bitte', 'jago', 'hallo', 'denn', 'es', 'sich', 'nicht', 'noch', 'schon', 'wieder', 'auch', 'als', 'so', 'mir', 'mich', 'du', 'hier', 'da',
  'dort', 'gibt', 'finde', 'finden', 'ueber', 'aus', 'nach', 'wenn', 'dann', 'habe', 'hat', 'haben', 'kein', 'keine', 'lassen', 'laesst', 'richtig']);
const woerter = (t) => falten(t).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !FUELL.has(w));
// Separable verbs („lade … ein“, „trage … ein“): the particle joins each other word, so „einlade“ finds „einladen“.
const PARTIKEL = new Set(['ein', 'an', 'aus', 'ab', 'zu', 'auf', 'vor', 'nach', 'zurueck', 'um']);
function woerterFrage(t) {
  const alle = falten(t).split(/[^a-z0-9]+/).filter(Boolean);
  const w = alle.filter((x) => x.length > 1 && !FUELL.has(x) && !PARTIKEL.has(x));
  return [...w, ...alle.filter((x) => PARTIKEL.has(x)).flatMap((p) => w.map((x) => p + x))];
}
const INDEX = THEMEN.map((t) => ({ t, titel: woerter(t.titel), stich: woerter(t.stichworte) }));
const gemeinsam = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

// The best topics for a question: a word in the title counts most, in the synonyms less. A word that differs only in
// its ending („Zählerstände“ – „Zählerstand“) counts like a synonym, a shared stem („abrechnen“ – „abrechnung“) least.
function treffer(frage, max = 5) {
  const w = woerterFrage(frage);
  if (!w.length) return [];
  return INDEX.map(({ t, titel, stich }) => {
    let punkte = 0;
    for (const x of w) {
      if (titel.includes(x)) { punkte += 3; continue; }
      if (stich.includes(x)) { punkte += 2; continue; }
      let best = 0;
      for (const y of [...titel, ...stich]) {
        const g = gemeinsam(x, y);
        if (g >= 4 && g >= 0.75 * Math.min(x.length, y.length)) best = Math.max(best, 2);
        else if (g >= 5) best = Math.max(best, 1);
      }
      punkte += best;
    }
    return { t, punkte };
  }).filter((x) => x.punkte >= 2).sort((a, b) => b.punkte - a.punkte).slice(0, max).map(({ t }) => t);
}

const datumDe = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('.') : '');

module.exports = function jago({ db, all, get }) {
  // b: who asks ({ id, verwalter }); null on a Mac working alone (one person): everything. Everyone else sees and
  // changes their own notes, a Verwalter all of them.
  const alles = (b) => !b || !!b.verwalter;
  const eigene = (b, id) => {
    const r = get('SELECT * FROM rueckmeldungen WHERE id = ?', id);
    if (!r || (!alles(b) && r.benutzer !== b.id)) throw new Error('Diese Rückmeldung gibt es nicht (mehr).');
    return r;
  };
  const liste = (b, status) => all(`SELECT r.*, u.name AS von FROM rueckmeldungen r LEFT JOIN benutzer u ON u.id = r.benutzer
      WHERE (?1 IS NULL OR r.status = ?1) AND (?2 = 1 OR r.benutzer = ?3) ORDER BY r.status = 'offen' DESC, r.id DESC`, status, alles(b) ? 1 : 0, b?.id ?? null)
    .map((r) => ({ ...r, diagnose: r.diagnose ? JSON.parse(r.diagnose) : null }));

  return {
    jagoHilfe: (frage) => treffer(frage),

    rueckmeldungNeu: (b, { art, text, seite = null, diagnose = null } = {}) => {
      const t = String(text ?? '').trim();
      if (!['fehler', 'idee'].includes(art)) throw new Error('Fehler oder Idee?');
      if (!t) throw new Error(art === 'fehler' ? 'Was ist passiert? Bitte kurz beschreiben.' : 'Was wäre gut? Bitte kurz beschreiben.');
      return Number(db.prepare('INSERT INTO rueckmeldungen (art, text, seite, version, benutzer, diagnose) VALUES (?, ?, ?, ?, ?, ?)')
        .run(art, t.slice(0, 4000), seite ? String(seite).slice(0, 80) : null, VERSION, b?.id ?? null, diagnose ? JSON.stringify(diagnose).slice(0, 20000) : null)
        .lastInsertRowid);
    },
    rueckmeldungen: (b, { status = null } = {}) => liste(b, status),
    rueckmeldungenOffen: (b) => get(`SELECT count(*) AS n FROM rueckmeldungen WHERE status = 'offen' AND (?1 = 1 OR benutzer = ?2)`, alles(b) ? 1 : 0, b?.id ?? null).n,
    rueckmeldungAendern: (b, id, { status, notiz } = {}) => {
      eigene(b, id);
      if (status !== undefined) {
        if (!['offen', 'erledigt', 'verworfen'].includes(status)) throw new Error('Unbekannter Status.');
        db.prepare('UPDATE rueckmeldungen SET status = ?, erledigt_am = ? WHERE id = ?').run(status, status === 'offen' ? null : new Date().toISOString(), id);
      }
      if (notiz !== undefined) db.prepare('UPDATE rueckmeldungen SET notiz = ? WHERE id = ?').run(String(notiz ?? '').trim() || null, id);
      return true;
    },
    // The notes as text to hand on (e.g. to Claude): faults first, each with what was going on.
    rueckmeldungenText: (b, { status = 'offen' } = {}) => {
      const r = liste(b, status);
      const teil = (art, titel) => {
        const x = r.filter((y) => y.art === art);
        if (!x.length) return '';
        return `## ${titel} (${x.length})\n\n${x.map((y) => {
          const d = y.diagnose;
          const zeilen = [`### #${y.id} · ${datumDe(y.erstellt)}${y.von ? ` · ${y.von}` : ''}${y.seite ? ` · Seite „${y.seite}“` : ''} · Version ${y.version ?? '?'}`, '', y.text];
          if (y.notiz) zeilen.push('', `Notiz: ${y.notiz}`);
          if (d) {
            zeilen.push('', `- Gerät: ${[d.geraet, d.bildschirm, d.online === false ? 'offline' : null].filter(Boolean).join(', ')}`);
            if (d.wege?.length) zeilen.push(`- Zuletzt: ${d.wege.join(' → ')}`);
            if (d.fehler?.length) zeilen.push('- Letzte Fehlermeldungen:', ...d.fehler.map((f) => `  - ${f.zeit ?? ''} ${f.text}`));
          }
          return zeilen.join('\n');
        }).join('\n\n')}\n\n`;
      };
      return `# Mietshaus – Ideen & Fehler\n\nStand ${datumDe(new Date().toISOString())}, Version ${VERSION}${status ? `, nur „${status}“` : ''}.\n\n`
        + (teil('fehler', 'Fehler') + teil('idee', 'Ideen') || 'Keine Einträge.\n');
    },
  };
};

module.exports.THEMEN = THEMEN;
module.exports.treffer = treffer;
