// Bank access per object account via FinTS 3.0 (PIN/TAN, PSD2 with pushTAN), using lib-fints. Runs only on the server or
// in the Mac app, never in the browser. Banks only answer registered products: the product number (free from the
// Deutsche Kreditwirtschaft, see ANLEITUNG-FINTS.md) comes from the settings or MIETSHAUS_FINTS_PRODUKT.
// Kept: bank code, FinTS address, chosen TAN method, account and the bank's parameters; the user id encrypted
// (geheim.cjs). Never kept: the PIN – it is asked for each time and held only for the running process (at most 10 minutes).
const crypto = require('node:crypto');
const { VERSION } = require('./version.cjs');

let bibliothek = null;
const LAUFZEIT = 10 * 60_000;
// The product version travels in a field of at most 5 characters: major.minor.
const PRODUKT_VERSION = VERSION.split('.').slice(0, 2).join('.');

const isoTag = (d) => (d instanceof Date && !Number.isNaN(d.getTime())
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);
const ibanNorm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

// Statements of lib-fints → the rows of the bank import (same shape as src/bankformate.ts). Identical transactions on
// the same day get a running number, so fetching overlapping periods again recognises what is already booked.
function umsaetze(statements) {
  const n = new Map();
  const out = [];
  for (const s of statements ?? []) {
    for (const t of s.transactions ?? []) {
      const datum = isoTag(t.entryDate) ?? isoTag(t.valueDate);
      if (!datum) continue;
      const betrag_ct = Math.round(Number(t.amount) * 100);
      const name = String(t.remoteName ?? '').trim();
      const zweck = String(t.purpose ?? t.additionalInformation ?? '').replace(/\s+/g, ' ').trim();
      const iban = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(ibanNorm(t.remoteAccountNumber)) ? ibanNorm(t.remoteAccountNumber) : '';
      const bankRef = t.bankReference && !/^NONREF$/i.test(t.bankReference) ? t.bankReference : '';
      const schluessel = `${datum}|${betrag_ct}|${name}|${zweck}|${bankRef}`;
      const i = (n.get(schluessel) ?? 0) + 1;
      n.set(schluessel, i);
      const hash = crypto.createHash('sha1').update(schluessel).digest('hex').slice(0, 16);
      out.push({ ref: `fints:${hash}${i > 1 ? `-${i}` : ''}`, datum, betrag_ct, name, iban, zweck });
    }
  }
  return out;
}

// The bank's own words for a refusal: its error answers (9xxx), else whatever it said.
const bankText = (r) => {
  const a = r?.bankAnswers ?? [];
  return (a.some((x) => x.code >= 9000) ? a.filter((x) => x.code >= 9000) : a).map((x) => `${x.text} (${x.code})`).join(' ') || 'Die Bank hat die Anfrage abgelehnt.';
};

// lib: only for the test (scripts/fintstest.cjs), a stand-in for lib-fints that plays the bank.
module.exports = function fints({ db, geheim, produkt = () => process.env.MIETSHAUS_FINTS_PRODUKT || db().einstellungen().fints_produkt || '', lib = null }) {
  const laden = () => (lib ? Promise.resolve(lib) : (bibliothek ??= import('lib-fints')));
  const vorgaenge = new Map();
  const einstellung = (objektId) => { try { return JSON.parse(db().einstellungen()[`fints_${objektId}`] ?? 'null'); } catch { return null; } };
  const speichern = (objektId, cfg) => db().setzeEinstellungen({ [`fints_${objektId}`]: cfg ? JSON.stringify(cfg) : null });
  const aufraeumen = () => { for (const [k, v] of vorgaenge) if (Date.now() - v.zeit > LAUFZEIT) vorgaenge.delete(k); };
  const pruefeProdukt = () => { if (!produkt()) throw new Error('Für den Kontoabruf fehlt die FinTS-Produktnummer (Einstellungen → Bankzugang). Wie man sie bekommt, steht in ANLEITUNG-FINTS.md.'); };

  // A step of a process: either finished (result), or the bank wants a TAN / an approval in the banking app, or the
  // user has to choose (TAN method, account). The process waits under its id.
  const vorgang = (daten) => { aufraeumen(); const id = crypto.randomUUID(); vorgaenge.set(id, { ...daten, zeit: Date.now() }); return id; };
  async function schritt(v, r, weiter, danach) {
    if (!r.success && !r.requiresTan) throw new Error(bankText(r));
    if (r.requiresTan) {
      const id = vorgang({ ...v, ref: r.tanReference, weiter, danach });
      const verfahren = v.client.config?.selectedTanMethod;
      return { vorgang: id, tan: { text: r.tanChallenge ?? 'Bitte den Auftrag freigeben.', entkoppelt: !!verfahren?.isDecoupled, medium: r.tanMediaName ?? null,
        bild: r.tanPhoto ? `data:${r.tanPhoto.mimeType};base64,${Buffer.from(r.tanPhoto.image).toString('base64')}` : null } };
    }
    return danach(r);
  }

  // Setting up: after the first synchronisation the TAN method is chosen, after the second the account.
  async function nachErsterSynchronisation(v) {
    const liste = v.client.config.availableTanMethods.filter((m) => m.id !== 999);
    if (liste.length === 1 && liste[0].activeTanMedia.length <= 1) return verfahrenSetzen(v, liste[0].id, liste[0].activeTanMedia[0]);
    return { vorgang: vorgang(v), verfahren: liste.map((m) => ({ id: m.id, name: m.name, entkoppelt: m.isDecoupled, medien: m.activeTanMedia })) };
  }
  async function verfahrenSetzen(v, id, medium) {
    v.client.selectTanMethod(Number(id));
    if (medium) v.client.selectTanMedia(medium);
    v.tanVerfahren = Number(id);
    v.tanMedium = medium ?? null;
    v.verfahrenName = v.client.config.selectedTanMethod?.name ?? null;
    return schritt(v, await v.client.synchronize(), (ref, tan) => v.client.synchronizeWithTan(ref, tan), () => kontoFinden(v));
  }
  function kontoFinden(v, iban = null) {
    const konten = (v.client.config.bankingInformation?.upd?.bankAccounts ?? []).filter((k) => k.iban);
    const gesucht = ibanNorm(iban ?? v.objektIban);
    const konto = konten.find((k) => ibanNorm(k.iban) === gesucht) ?? (konten.length === 1 ? konten[0] : null);
    if (!konto) return { vorgang: vorgang(v), konten: konten.map((k) => ({ iban: k.iban, name: [k.product, k.holder1].filter(Boolean).join(' · ') })) };
    geheim.setzen(v.kennung, `fints${v.objektId}`);
    speichern(v.objektId, { blz: v.blz, url: v.url, tanVerfahren: v.tanVerfahren, tanMedium: v.tanMedium, verfahrenName: v.verfahrenName, iban: konto.iban,
      bankingInformation: v.client.config.bankingInformation, eingerichtet: new Date().toISOString() });
    return { fertig: true, iban: konto.iban };
  }

  return {
    status: (objektId) => {
      const c = einstellung(objektId);
      return { produkt: !!produkt(), eingerichtet: !!c, blz: c?.blz ?? null, url: c?.url ?? null, iban: c?.iban ?? null,
        verfahren: c?.verfahrenName ?? null,
        zuletzt: c?.zuletzt ?? null };
    },

    einrichten: async ({ objektId, blz, url, kennung, pin, objektIban }) => {
      pruefeProdukt();
      if (!/^\d{8}$/.test(String(blz ?? ''))) throw new Error('Die Bankleitzahl hat 8 Ziffern.');
      if (!/^https:\/\/\S+$/.test(String(url ?? ''))) throw new Error('Die FinTS-Adresse der Bank beginnt mit https://');
      if (!kennung || !pin) throw new Error('Bitte Anmeldename (Kennung) und PIN eingeben.');
      const { FinTSClient, FinTSConfig } = await laden();
      const client = new FinTSClient(FinTSConfig.forFirstTimeUse(produkt(), PRODUKT_VERSION, url, String(blz), String(kennung), String(pin)));
      const v = { art: 'einrichten', client, objektId, blz: String(blz), url, kennung: String(kennung), objektIban };
      return schritt(v, await client.synchronize(), (ref, tan) => client.synchronizeWithTan(ref, tan), () => nachErsterSynchronisation(v));
    },

    // Fetches the transactions (from a day on, else what the bank offers – usually 90 days) of the object's account.
    abrufen: async ({ objektId, pin, von = null }) => {
      pruefeProdukt();
      const c = einstellung(objektId);
      if (!c) throw new Error('Für dieses Konto ist noch kein Bankzugang eingerichtet.');
      if (!pin) throw new Error('Bitte die PIN eingeben.');
      const { FinTSClient, FinTSConfig } = await laden();
      const config = FinTSConfig.fromBankingInformation(produkt(), PRODUKT_VERSION, c.bankingInformation, geheim.lesen(`fints${objektId}`), String(pin), c.tanVerfahren, c.tanMedium ?? undefined);
      const client = new FinTSClient(config);
      const konto = (c.bankingInformation?.upd?.bankAccounts ?? []).find((k) => ibanNorm(k.iban) === ibanNorm(c.iban)) ?? c.iban;
      const v = { art: 'abrufen', client, objektId };
      const fertig = (r) => {
        speichern(objektId, { ...c, bankingInformation: r.bankingInformationUpdated ? config.bankingInformation : c.bankingInformation, zuletzt: new Date().toISOString() });
        return { fertig: true, umsaetze: umsaetze(r.statements) };
      };
      return schritt(v, await client.getAccountStatements(konto, von ? new Date(`${von}T00:00:00`) : undefined),
        (ref, tan) => client.getAccountStatementsWithTan(ref, tan), fertig);
    },

    // Continues a waiting process: with the TAN, or (pushTAN) once approved in the banking app – until then it waits.
    weiter: async ({ vorgang: id, tan = null, verfahren = null, medium = null, iban = null }) => {
      const v = vorgaenge.get(id);
      if (!v) throw new Error('Dieser Vorgang ist abgelaufen. Bitte noch einmal beginnen.');
      vorgaenge.delete(id);
      if (verfahren != null) return verfahrenSetzen(v, verfahren, medium);
      if (iban) return kontoFinden(v, iban);
      const r = await v.weiter(v.ref, tan || undefined);
      const s = await schritt(v, r, v.weiter, v.danach);
      // pushTAN not approved yet: the same question again, marked as waiting.
      return r.requiresTan ? { ...s, wartet: true } : s;
    },

    abbrechen: (id) => { vorgaenge.delete(id); },
    entfernen: (objektId) => { speichern(objektId, null); db().setzeEinstellungen(Object.fromEntries(['server', 'enc', 'klar'].map((x) => [`fints${objektId}_passwort_${x}`, null]))); },
  };
};

module.exports.umsaetze = umsaetze;
