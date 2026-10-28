// A software passkey for tests: creates a P-256 key pair and answers WebAuthn registration and login like a phone
// would (attestation "none"). Only for scripts/servertest.cjs.
const crypto = require('node:crypto');

// Minimal CBOR: unsigned and negative integers, byte strings, text, maps.
function cbor(x) {
  const kopf = (major, n) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n])
    : n < 65536 ? Buffer.from([(major << 5) | 25, n >> 8, n & 255]) : Buffer.concat([Buffer.from([(major << 5) | 26]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; })()]));
  if (typeof x === 'number') return x >= 0 ? kopf(0, x) : kopf(1, -1 - x);
  if (Buffer.isBuffer(x)) return Buffer.concat([kopf(2, x.length), x]);
  if (typeof x === 'string') { const b = Buffer.from(x, 'utf8'); return Buffer.concat([kopf(3, b.length), b]); }
  if (x instanceof Map) return Buffer.concat([kopf(5, x.size), ...[...x].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error('cbor: Typ');
}
const b64 = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();

function authenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const id = crypto.randomBytes(16);
  let zaehler = 0;
  let nutzer = null;
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const zahl = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  return {
    registrieren(optionen, origin) {
      nutzer = optionen.user.id;
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: optionen.challenge, origin, crossOrigin: false }));
      const len = Buffer.alloc(2); len.writeUInt16BE(id.length);
      const authData = Buffer.concat([sha(optionen.rp.id), Buffer.from([0x45]), zahl(0), Buffer.alloc(16), len, id, cose]);
      const attestation = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      return { id: b64(id), rawId: b64(id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(client), attestationObject: b64(attestation), transports: ['internal'] } };
    },
    anmelden(optionen, origin) {
      const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: optionen.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([sha(optionen.rpId), Buffer.from([0x05]), zahl(++zaehler)]);
      const signatur = crypto.sign('sha256', Buffer.concat([authData, sha(client)]), privateKey);
      return { id: b64(id), rawId: b64(id), type: 'public-key', authenticatorAttachment: 'platform', clientExtensionResults: {},
        response: { clientDataJSON: b64(client), authenticatorData: b64(authData), signature: b64(signatur), userHandle: nutzer } };
    },
  };
}

module.exports = { authenticator };
