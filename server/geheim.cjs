// The mail password on the server: AES-256-GCM with a key file next to the database (mode 600). It keeps the password out
// of backups and copies of the database; whoever can read the data folder of the server can read the key as well.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = function geheim(ordner, db) {
  const datei = path.join(ordner, 'schluessel.bin');
  const schluessel = () => {
    if (!fs.existsSync(datei)) fs.writeFileSync(datei, crypto.randomBytes(32), { mode: 0o600 });
    return fs.readFileSync(datei);
  };
  return {
    lesen: () => {
      const e = db().einstellungen();
      if (!e.mail_passwort_server) return '';
      try {
        const roh = Buffer.from(e.mail_passwort_server, 'base64');
        const d = crypto.createDecipheriv('aes-256-gcm', schluessel(), roh.subarray(0, 12));
        d.setAuthTag(roh.subarray(12, 28));
        return Buffer.concat([d.update(roh.subarray(28)), d.final()]).toString('utf8');
      } catch {
        throw new Error('Das gespeicherte E-Mail-Passwort lässt sich nicht entschlüsseln (Schlüsseldatei fehlt oder ist neu). Bitte unter Einstellungen → Dokumenteneingang neu eingeben.');
      }
    },
    setzen: (pw) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', schluessel(), iv);
      const inhalt = Buffer.concat([c.update(String(pw), 'utf8'), c.final()]);
      db().setzeEinstellungen({ mail_passwort_server: Buffer.concat([iv, c.getAuthTag(), inhalt]).toString('base64'), mail_passwort_enc: null, mail_passwort_klar: null });
    },
    verschluesselt: true,
  };
};
