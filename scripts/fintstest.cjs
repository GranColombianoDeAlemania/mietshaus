// Test of the bank access (electron/fints.cjs) against a played bank: setting up with a choice of TAN method, approval
// by pushTAN (first not yet, then given), choosing the account by the object's IBAN, fetching transactions (MT940 read
// by lib-fints' own parser) and recognising them as already booked when fetched again. The PIN is never stored.
// Run: ELECTRON_RUN_AS_NODE=1 npx electron scripts/fintstest.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open, api } = require('../electron/db.cjs');
const fints = require('../electron/fints.cjs');

let richtig = 0, falsch = 0;
const pruefe = (name, ok, info = '') => { if (ok) richtig++; else { falsch++; console.log('FALSCH', name, info); } };

const MT940 = ':20:STARTUMS\r\n:25:12030000/1234567890\r\n:28C:1/1\r\n:60F:C261031EUR1000,00\r\n'
  + ':61:2611031103CR850,00NTRFNONREF//4711\r\n:86:166?00GUTSCHRIFT?20SVWZ+Miete November EG links?30BYLADEM1001?31DE02120300000000202051?32MEIER ANNA\r\n'
  + ':61:2611051105DR48,90NDDTNONREF\r\n:86:105?00LASTSCHRIFT?20SVWZ+Silikon und Dichtband?32BAUMARKT SCHMIDT\r\n'
  + ':62F:C261130EUR1801,10\r\n';

(async () => {
  const { Mt940Parser } = await import('lib-fints');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-fints-'));
  const raw = open(path.join(ordner, 'test.sqlite'), 'app', { id: 'pc', name: 'test@mac' });
  const db = api(raw);
  const geheimnisse = {};
  const geheim = { lesen: (n) => geheimnisse[n] ?? '', setzen: (pw, n) => { geheimnisse[n] = pw; } };

  // The played bank: two TAN methods, pushTAN for the second synchronisation and the statements (first "not yet").
  const protokoll = [];
  class FinTSConfig {
    static forFirstTimeUse(produkt, version, url, blz, kennung, pin) { return Object.assign(new FinTSConfig(), { produkt, version, url, blz, kennung, pin, bankingInformation: { systemId: '0' } }); }
    static fromBankingInformation(produkt, version, bi, kennung, pin, tan, medium) { return Object.assign(new FinTSConfig(), { produkt, version, bankingInformation: bi, kennung, pin, tan, medium }); }
    get availableTanMethods() { return [{ id: 999, name: 'Ein-Schritt', activeTanMedia: [] }, { id: 921, name: 'pushTAN', isDecoupled: true, activeTanMedia: ['Handy Erika'] }, { id: 942, name: 'chipTAN', isDecoupled: false, activeTanMedia: [] }]; }
    get selectedTanMethod() { return this.availableTanMethods.find((m) => m.id === this.tan); }
  }
  let freigabeVersuche = 0;
  class FinTSClient {
    constructor(config) { this.config = config; }
    selectTanMethod(id) { this.config.tan = id; }
    selectTanMedia(m) { this.config.medium = m; }
    async synchronize() {
      protokoll.push(['synchronize', this.config.pin, this.config.produkt]);
      if (!this.config.tan) return { success: true, requiresTan: false, bankAnswers: [] };
      return { success: true, requiresTan: true, tanReference: 'ref-sync', tanChallenge: 'Bitte in der S-pushTAN-App freigeben', bankAnswers: [] };
    }
    async synchronizeWithTan(ref) {
      protokoll.push(['synchronizeWithTan', ref]);
      if (++freigabeVersuche < 2) return { success: true, requiresTan: true, tanReference: ref, bankAnswers: [{ code: 3956, text: 'Starke Kundenauthentifizierung noch ausstehend' }] };
      this.config.bankingInformation = { systemId: '42', upd: { bankAccounts: [
        { iban: 'DE89370400440532013000', product: 'Sparkonto', holder1: 'Erika Mustermann' },
        { iban: 'DE02120300000000202051', product: 'Girokonto', holder1: 'Erika Mustermann' }] } };
      return { success: true, requiresTan: false, bankAnswers: [] };
    }
    async getAccountStatements(konto, von) {
      protokoll.push(['statements', konto.iban ?? konto, von ? von.toISOString() : null, this.config.pin, this.config.tan]);
      if (this.config.pin !== '12345') return { success: false, requiresTan: false, bankAnswers: [{ code: 9931, text: 'PIN falsch' }] };
      return { success: true, requiresTan: true, tanReference: 'ref-kaz', tanChallenge: 'TAN zum Umsatzabruf', bankAnswers: [] };
    }
    async getAccountStatementsWithTan(ref, tan) {
      protokoll.push(['statementsWithTan', ref, tan]);
      return { success: true, requiresTan: false, bankingInformationUpdated: false, statements: new Mt940Parser(MT940).parse(), bankAnswers: [] };
    }
  }
  const bank = fints({ db: () => db, geheim, lib: { FinTSClient, FinTSConfig }, produkt: () => db.einstellungen().fints_produkt || '' });

  const objektId = db.neuesObjekt({ bezeichnung: 'Bankhaus', art: 'miete' });
  db.save('objekte', { id: objektId, iban: 'DE02 1203 0000 0000 2020 51' });

  // ---------- without product number ----------
  pruefe('Ohne Produktnummer abgelehnt', await bank.einrichten({ objektId, blz: '12030000', url: 'https://fints.bank.example/fints', kennung: 'erika', pin: '12345' })
    .then(() => false, (e) => /Produktnummer/.test(e.message)));
  pruefe('Status: Registrierung ausstehend', bank.status(objektId).produkt === false && bank.status(objektId).eingerichtet === false);
  db.setzeEinstellungen({ fints_produkt: 'TESTPRODUKT123' });

  // ---------- setting up ----------
  pruefe('Falsche Bankleitzahl abgelehnt', await bank.einrichten({ objektId, blz: '1203', url: 'https://x', kennung: 'e', pin: 'p' }).then(() => false, (e) => /8 Ziffern/.test(e.message)));
  let a = await bank.einrichten({ objektId, blz: '12030000', url: 'https://fints.bank.example/fints', kennung: 'erika', pin: '12345', objektIban: 'DE02 1203 0000 0000 2020 51' });
  pruefe('TAN-Verfahren zur Wahl (ohne Ein-Schritt)', a.vorgang && a.verfahren?.map((v) => v.id).join() === '921,942', JSON.stringify(a));
  pruefe('Produktnummer und Version an die Bank', protokoll[0][2] === 'TESTPRODUKT123');
  a = await bank.weiter({ vorgang: a.vorgang, verfahren: 921, medium: 'Handy Erika' });
  pruefe('pushTAN: Freigabe angefragt', a.tan?.entkoppelt === true && /pushTAN/.test(a.tan.text), JSON.stringify(a));
  a = await bank.weiter({ vorgang: a.vorgang });
  pruefe('Noch nicht freigegeben: wartet', a.wartet === true && !!a.vorgang && a.tan?.entkoppelt, JSON.stringify(a));
  a = await bank.weiter({ vorgang: a.vorgang });
  pruefe('Freigegeben: Konto über die IBAN des Objekts gefunden', a.fertig === true && a.iban === 'DE02120300000000202051', JSON.stringify(a));
  const gespeichert = db.einstellungen()[`fints_${objektId}`];
  pruefe('Gespeichert ohne PIN und ohne Kennung im Klartext', gespeichert && !gespeichert.includes('12345') && !gespeichert.includes('erika') && geheimnisse[`fints${objektId}`] === 'erika', gespeichert);
  const st = bank.status(objektId);
  pruefe('Status eingerichtet', st.eingerichtet && st.verfahren === 'pushTAN' && st.iban === 'DE02120300000000202051', JSON.stringify(st));
  pruefe('Abgelaufener Vorgang', await bank.weiter({ vorgang: a.vorgang ?? 'weg' }).then(() => false, (e) => /abgelaufen/.test(e.message)));

  // ---------- fetching ----------
  pruefe('Falsche PIN: Text der Bank', await bank.abrufen({ objektId, pin: '00000' }).then(() => false, (e) => /PIN falsch \(9931\)/.test(e.message)));
  a = await bank.abrufen({ objektId, pin: '12345', von: '2026-11-01' });
  pruefe('Abruf mit Kennung, Verfahren und Datum', protokoll.at(-1)[1] === 'DE02120300000000202051' && protokoll.at(-1)[2].startsWith('2026-1') && protokoll.at(-1)[4] === 921, JSON.stringify(protokoll.at(-1)));
  pruefe('TAN verlangt', a.tan && a.tan.entkoppelt === true);
  a = await bank.weiter({ vorgang: a.vorgang, tan: null });
  pruefe('Zwei Umsätze', a.fertig && a.umsaetze.length === 2, JSON.stringify(a));
  const [miete, baumarkt] = a.umsaetze;
  pruefe('Miete richtig gelesen', miete.datum === '2026-11-03' && miete.betrag_ct === 85000 && miete.name === 'MEIER ANNA' && miete.iban === 'DE02120300000000202051' && miete.zweck === 'Miete November EG links', JSON.stringify(miete));
  pruefe('Lastschrift negativ', baumarkt.betrag_ct === -4890 && baumarkt.iban === '', JSON.stringify(baumarkt));
  pruefe('Zuletzt abgerufen vermerkt', !!bank.status(objektId).zuletzt);

  // ---------- into the bank import: booked once, recognised when fetched again ----------
  const konten = db.konten(objektId);
  const giro = konten.find((k) => k.klasse === 'geld');
  const kosten = konten.find((k) => k.klasse === 'kosten');
  const v1 = db.bankVorschlaege(objektId, a.umsaetze);
  pruefe('Vorschläge ohne Doppelte', v1.length === 2 && v1.every((u) => !u.doppelt));
  pruefe('Gebucht', db.bankBuchen(objektId, giro.id, [{ ...baumarkt, konto_id: kosten.id }], false) === 1);
  const zweiter = fints.umsaetze(new Mt940Parser(MT940).parse());
  pruefe('Gleiche Referenz beim zweiten Abruf', zweiter[1].ref === baumarkt.ref);
  pruefe('Zweiter Abruf: schon gebucht erkannt', db.bankVorschlaege(objektId, zweiter).find((u) => u.ref === baumarkt.ref)?.doppelt === true);

  bank.entfernen(objektId);
  pruefe('Entfernt', bank.status(objektId).eingerichtet === false && !db.einstellungen()[`fints${objektId}_passwort_server`]);

  console.log(`FinTS-Test: ${richtig} Prüfungen richtig, ${falsch} falsch.`);
  process.exit(falsch ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
