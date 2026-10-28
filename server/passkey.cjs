// Login with a passkey (Touch ID, Face ID, a security key) instead of the password, by WebAuthn (SimpleWebAuthn).
// Only the public key is stored. The server name the browser sees (rpID) is the host of the request – with Tailscale
// serve e.g. nas.tailnet.ts.net; passkeys work only over HTTPS (or on localhost).
const crypto = require('node:crypto');
const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');

module.exports = function passkey(raw) {
  const db = () => raw();
  const offen = new Map(); // challenge per waiting step, 5 minutes
  const merken = (schluessel, challenge) => { offen.set(schluessel, { challenge, bis: Date.now() + 5 * 60_000 }); };
  const nehmen = (schluessel) => {
    const c = offen.get(schluessel);
    offen.delete(schluessel);
    if (!c || c.bis < Date.now()) throw new Error('Die Anfrage ist abgelaufen. Bitte noch einmal.');
    return c.challenge;
  };
  // The site the browser is on: host and scheme of the request (behind Tailscale serve from its headers).
  const seite = (req) => {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost');
    const proto = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'https' : 'http';
    return { rpID: host.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''), origin: `${proto}://${host}` };
  };

  return {
    liste: (benutzerId) => db().prepare('SELECT id, name, erstellt, zuletzt FROM passkeys WHERE benutzer_id = ? ORDER BY erstellt').all(benutzerId),
    loeschen: (benutzerId, id) => db().prepare('DELETE FROM passkeys WHERE benutzer_id = ? AND id = ?').run(benutzerId, String(id)),

    registrierenOptionen: async (req, benutzer, sitzung) => {
      const { rpID } = seite(req);
      const vorhanden = db().prepare('SELECT id, transporte FROM passkeys WHERE benutzer_id = ?').all(benutzer.id);
      const o = await generateRegistrationOptions({ rpName: 'Mietshaus', rpID, userName: benutzer.login, userDisplayName: benutzer.name,
        userID: new TextEncoder().encode(`mietshaus-${benutzer.id}`), attestationType: 'none',
        excludeCredentials: vorhanden.map((p) => ({ id: p.id, transports: p.transporte ? JSON.parse(p.transporte) : undefined })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' } });
      merken(`reg:${sitzung}`, o.challenge);
      return o;
    },
    registrieren: async (req, benutzer, sitzung, antwort, name) => {
      const { rpID, origin } = seite(req);
      const v = await verifyRegistrationResponse({ response: antwort, expectedChallenge: nehmen(`reg:${sitzung}`), expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
      if (!v.verified || !v.registrationInfo) throw new Error('Der Passkey ließ sich nicht prüfen.');
      const c = v.registrationInfo.credential;
      db().prepare('INSERT INTO passkeys (id, benutzer_id, oeffentlich, zaehler, transporte, name) VALUES (?, ?, ?, ?, ?, ?)')
        .run(c.id, benutzer.id, Buffer.from(c.publicKey).toString('base64url'), c.counter, JSON.stringify(c.transports ?? antwort.response?.transports ?? []), String(name || 'Passkey').slice(0, 60));
      return { id: c.id };
    },

    anmeldenOptionen: async (req) => {
      const { rpID } = seite(req);
      const o = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
      const vorgang = crypto.randomUUID();
      merken(`anm:${vorgang}`, o.challenge);
      return { vorgang, optionen: o };
    },
    // The user behind a valid passkey answer, or an error.
    anmelden: async (req, vorgang, antwort) => {
      const { rpID, origin } = seite(req);
      const challenge = nehmen(`anm:${vorgang}`);
      const p = db().prepare('SELECT p.*, b.aktiv FROM passkeys p JOIN benutzer b ON b.id = p.benutzer_id WHERE p.id = ?').get(String(antwort?.id ?? ''));
      if (!p || !p.aktiv) throw new Error('Diesen Passkey kennt der Server nicht (mehr).');
      const v = await verifyAuthenticationResponse({ response: antwort, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: { id: p.id, publicKey: Buffer.from(p.oeffentlich, 'base64url'), counter: p.zaehler, transports: p.transporte ? JSON.parse(p.transporte) : undefined } });
      if (!v.verified) throw new Error('Passkey abgelehnt.');
      db().prepare('UPDATE passkeys SET zaehler = ?, zuletzt = ? WHERE id = ?').run(v.authenticationInfo.newCounter, new Date().toISOString(), p.id);
      return p.benutzer_id;
    },
  };
};
