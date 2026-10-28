// Sending e-mails from Mietshaus (SMTP). Every mail sent is kept in the archive as an .eml file with the person or
// house it concerns, so the letter and its attachments are on file. Attachments are documents of the archive.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const nodemailer = require('nodemailer');
const MailComposer = require('nodemailer/lib/mail-composer');

module.exports = function versand({ db, passwort, dokumentOrdner, importieren }) {
  function konfig() {
    const e = db().einstellungen();
    if (!e.smtp_server) throw new Error('Für den E-Mail-Versand fehlt der SMTP-Server (Einstellungen → E-Mail-Versand).');
    // Without its own password the one of the mailbox for fetching is used (often the same account).
    const pw = passwort.lesen('smtp') || (e.smtp_benutzer && e.smtp_benutzer === e.mail_benutzer ? passwort.lesen('mail') : '');
    const art = e.smtp_ssl ?? 'starttls';
    return {
      transport: { host: e.smtp_server, port: Number(e.smtp_port) || (art === 'ssl' ? 465 : 587), secure: art === 'ssl', requireTLS: art === 'starttls',
        ignoreTLS: art === 'kein', auth: e.smtp_benutzer ? { user: e.smtp_benutzer, pass: pw } : undefined, connectionTimeout: 20_000 },
      absender: e.smtp_absender || e.smtp_benutzer || e.verwalter_email,
      kopie: e.smtp_kopie === '1',
    };
  }

  async function testen() {
    const k = konfig();
    await nodemailer.createTransport(k.transport).verify();
    return `Verbindung zum SMTP-Server ${k.transport.host} erfolgreich.`;
  }

  // m: { an, cc, betreff, text, dokumente: [ids], ablage: { objekt_id, person_id, einheit_id } }
  async function senden(m) {
    const k = konfig();
    const an = String(m.an ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+(\s*[,;]\s*[^@\s]+@[^@\s]+\.[^@\s]+)*$/.test(an)) throw new Error('Bitte eine gültige E-Mail-Adresse angeben.');
    if (!String(m.betreff ?? '').trim()) throw new Error('Bitte einen Betreff angeben.');
    const anhaenge = (m.dokumente ?? []).map((id) => {
      const d = db().dokument(id);
      if (!d) throw new Error(`Dokument ${id} nicht gefunden.`);
      // The title as file name, always with the file's own ending, so the recipient's program can open it.
      const endung = path.extname(d.datei);
      const name = (d.titel || d.name || 'Dokument').replace(/[/\\:*?"<>|]/g, '_');
      return { filename: name.toLowerCase().endsWith(endung.toLowerCase()) ? name : `${name}${endung}`, path: path.join(dokumentOrdner(), path.basename(d.datei)) };
    });
    const mail = { from: k.absender, to: an.split(/\s*[,;]\s*/), cc: m.cc || undefined, bcc: k.kopie ? k.absender : undefined, subject: m.betreff, text: m.text ?? '', attachments: anhaenge };
    const info = await nodemailer.createTransport(k.transport).sendMail(mail);
    // The sent mail into the archive (without the copy to oneself).
    const eml = await new MailComposer({ ...mail, bcc: undefined, messageId: info.messageId, date: new Date() }).compile().build();
    const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-mail-'));
    try {
      const datei = path.join(ordner, `E-Mail ${String(m.betreff).replace(/[/\\:*?"<>|]/g, '_').slice(0, 60)}.eml`);
      fs.writeFileSync(datei, eml);
      const [r] = importieren([datei], { ...(m.ablage ?? {}), typ: 'E-Mail', status: 'abgelegt', quelle: 'programm' });
      db().dokumentSpeichern({ id: r.id, titel: `E-Mail: ${m.betreff}`, datum: new Date().toISOString().slice(0, 10),
        zusammenfassung: `Gesendet an ${an}${anhaenge.length ? ` mit ${anhaenge.length} Anhang/Anhängen` : ''}.`, person_id: m.ablage?.person_id ?? null });
      return { gesendet: true, an, dokument_id: r.id };
    } finally {
      fs.rmSync(ordner, { recursive: true, force: true });
    }
  }

  return { senden, testen };
};
