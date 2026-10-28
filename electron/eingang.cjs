// Automatic document intake: a watched folder (scanner, iPhone, NAS share) and an e-mail mailbox (IMAP).
// Everything lands in the inbox (Postfach); nothing is deleted at the source except moving processed files
// into a sub-folder "eingelesen" so they are not picked up twice.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ortszeit = require('./zeit.cjs');

const ERLAUBT = /\.(pdf|png|jpe?g|tiff?|heic|webp|gif|bmp|txt|csv|xml|docx?|xlsx?|odt|ods|eml)$/i;

module.exports = function eingang({ db, importieren, melden, passwort }) {
  // ---------- watched folder ----------
  let ordner = null;
  let watcher = null;
  let timer = null;
  const groessen = new Map();

  function ordnerScan() {
    if (!ordner || !fs.existsSync(ordner)) return;
    const neu = [];
    for (const name of fs.readdirSync(ordner)) {
      if (name.startsWith('.') || !ERLAUBT.test(name)) continue;
      const p = path.join(ordner, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (!st.isFile()) continue;
      // Only take files whose size did not change since the last scan (still being written otherwise).
      if (groessen.get(p) !== st.size) { groessen.set(p, st.size); continue; }
      groessen.delete(p);
      neu.push(p);
    }
    if (!neu.length) return;
    const r = importieren(neu, { quelle: 'ordner' });
    const ziel = path.join(ordner, 'eingelesen', ortszeit.monatJetzt());
    fs.mkdirSync(ziel, { recursive: true });
    for (const p of neu) {
      let dest = path.join(ziel, path.basename(p));
      if (fs.existsSync(dest)) dest = path.join(ziel, `${Date.now()}-${path.basename(p)}`);
      try { fs.renameSync(p, dest); } catch { try { fs.copyFileSync(p, dest); fs.rmSync(p); } catch {} }
    }
    melden(`${r.filter((x) => !x.doppelt).length} Dokument(e) aus dem Eingangsordner ins Postfach übernommen.`);
  }

  function ordnerSetzen(pfad) {
    if (watcher) watcher.close();
    clearInterval(timer);
    watcher = null;
    ordner = pfad || null;
    if (!ordner) return;
    fs.mkdirSync(ordner, { recursive: true });
    try { watcher = fs.watch(ordner, () => setTimeout(ordnerScan, 1500)); } catch {}
    // Network shares do not always send change events, so scan regularly as well.
    timer = setInterval(ordnerScan, 30_000);
    setTimeout(ordnerScan, 2000);
  }

  // ---------- e-mail ----------
  const anhaenge = (struktur, out = []) => {
    if (!struktur) return out;
    if (struktur.childNodes) for (const c of struktur.childNodes) anhaenge(c, out);
    else {
      const name = struktur.dispositionParameters?.filename ?? struktur.parameters?.name;
      // Small inline images are signature logos, not documents.
      const logo = struktur.disposition !== 'attachment' && /^image\//.test(struktur.type) && (struktur.size ?? 0) < 30_000;
      if (name && !logo && (struktur.disposition === 'attachment' || struktur.disposition === 'inline' || /^(application|image)\//.test(struktur.type)) && ERLAUBT.test(name))
        out.push({ part: struktur.part ?? '1', name, typ: struktur.type });
    }
    return out;
  };
  const textTeil = (struktur) => {
    if (!struktur) return null;
    if (struktur.childNodes) {
      for (const c of struktur.childNodes) { const t = textTeil(c); if (t) return t; }
      return null;
    }
    return struktur.type === 'text/plain' && !struktur.disposition ? struktur.part ?? '1' : null;
  };
  const lesen = async (stream) => {
    const teile = [];
    for await (const c of stream) teile.push(c);
    return Buffer.concat(teile);
  };

  function konfig() {
    const e = db.einstellungen();
    return { host: e.mail_server, port: Number(e.mail_port) || 993, secure: e.mail_ssl !== '0', user: e.mail_benutzer,
      ordner: e.mail_ordner || 'INBOX', ab: e.mail_ab || null, texte: e.mail_texte === '1', aktiv: e.mail_aktiv === '1' };
  }

  async function verbinden(k) {
    const { ImapFlow } = require('imapflow');
    const client = new ImapFlow({ host: k.host, port: k.port, secure: k.secure, auth: { user: k.user, pass: passwort.lesen() }, logger: false, socketTimeout: 60_000 });
    await client.connect();
    return client;
  }

  async function mailTesten() {
    const k = konfig();
    const client = await verbinden(k);
    try {
      const st = await client.status(k.ordner, { messages: true, unseen: true });
      return `Verbindung erfolgreich: ${st.messages} Nachrichten in „${k.ordner}“.`;
    } finally {
      await client.logout().catch(() => {});
    }
  }

  // Fetches messages that arrived since the last run and puts their attachments into the inbox.
  let abrufLaeuft = false;
  async function mailAbrufen() {
    if (abrufLaeuft) return { neu: 0 };
    abrufLaeuft = true;
    const k = konfig();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-mail-'));
    let client;
    let neu = 0, mails = 0;
    try {
      client = await verbinden(k);
      const lock = await client.getMailboxLock(k.ordner);
      try {
        const e = db.einstellungen();
        const gueltig = String(client.mailbox.uidValidity);
        // A changed UIDVALIDITY means the server renumbered the mailbox: start over from the configured date.
        let letzte = e.mail_uidvalidity === gueltig ? Number(e.mail_letzte_uid) || 0 : 0;
        const suche = letzte ? { uid: `${letzte + 1}:*` } : k.ab ? { since: new Date(k.ab) } : { since: new Date(Date.now() - 30 * 864e5) };
        const uids = (await client.search(suche, { uid: true })).filter((u) => u > letzte);
        for (const uid of uids) {
          const m = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true });
          if (!m) continue;
          mails++;
          const von = m.envelope?.from?.[0];
          const absender = von?.name || von?.address || '';
          const info = `E-Mail von ${absender}${von?.address && von?.name ? ` <${von.address}>` : ''} vom ${m.envelope?.date ? new Date(m.envelope.date).toLocaleDateString('de-DE') : ''}: ${m.envelope?.subject ?? ''}`;
          const dateien = [];
          for (const a of anhaenge(m.bodyStructure)) {
            const { content } = await client.download(String(uid), a.part, { uid: true });
            const p = path.join(tmp, `${crypto.randomUUID()}-${a.name.replace(/[/\\:]/g, '_')}`);
            fs.writeFileSync(p, await lesen(content));
            dateien.push(p);
          }
          if (!dateien.length && k.texte) {
            const teil = textTeil(m.bodyStructure);
            if (teil) {
              const { content } = await client.download(String(uid), teil, { uid: true });
              const p = path.join(tmp, `E-Mail ${(m.envelope?.subject ?? 'ohne Betreff').replace(/[/\\:*?"<>|]/g, '_').slice(0, 60)}.txt`);
              fs.writeFileSync(p, `${info}\n\n${(await lesen(content)).toString('utf8')}`);
              dateien.push(p);
            }
          }
          if (dateien.length) {
            for (const r of importieren(dateien, { quelle: 'email' })) {
              if (r.doppelt) continue;
              neu++;
              db.dokumentSpeichern({ id: r.id, zusammenfassung: info.slice(0, 500), titel: r.name.replace(/^[0-9a-f-]{36}-/, '').replace(/\.[^.]+$/, '') });
            }
          }
          letzte = Math.max(letzte, uid);
          db.setzeEinstellungen({ mail_letzte_uid: String(letzte), mail_uidvalidity: gueltig });
        }
      } finally {
        lock.release();
      }
      db.setzeEinstellungen({ mail_letzter_abruf: new Date().toISOString(), mail_letzter_fehler: '' });
      if (neu) melden(`${neu} Dokument(e) aus ${mails} E-Mail(s) ins Postfach übernommen.`);
      return { neu, mails };
    } catch (e) {
      db.setzeEinstellungen({ mail_letzter_fehler: String(e?.message ?? e).slice(0, 300) });
      throw e;
    } finally {
      abrufLaeuft = false;
      if (client) await client.logout().catch(() => {});
      // Imported files were copied into the archive; the temporary copies can go.
      setTimeout(() => fs.rmSync(tmp, { recursive: true, force: true }), 5000);
    }
  }

  let mailTimer = null;
  function mailPlanen() {
    clearInterval(mailTimer);
    if (konfig().aktiv) mailTimer = setInterval(() => mailAbrufen().catch(() => {}), 15 * 60_000);
  }

  return { ordnerSetzen, ordnerScan, mailTesten, mailAbrufen, mailPlanen };
};
