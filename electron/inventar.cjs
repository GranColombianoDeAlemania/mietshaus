// Inventory of a house and its units: fitted kitchens, appliances, building services – with purchase, warranty and
// the invoice. Items bought for a rented unit are written off over their useful life (§ 7 Abs. 1 EStG), monthly in
// the year of purchase; low-value items (up to 800 € net, § 6 Abs. 2 EStG) in full in that year.
const ortszeit = require('./zeit.cjs');

// [key, label, usual useful life]; fixed building services are part of the building – replacing them is maintenance
// (deducted at once as Instandhaltung), so they are listed for warranty and service only, without a write-off.
const KATEGORIEN = [
  ['kueche', 'Einbauküche', 10], ['geraet', 'Gerät (Herd, Spülmaschine, Waschmaschine …)', 10], ['moebel', 'Möbel', 13],
  ['haustechnik', 'Fest eingebaute Haustechnik (Pumpe, Heizung, Rauchmelder …) – keine Abschreibung', null], ['sonstiges', 'Sonstiges', 10],
];
const GWG_GRENZE_NETTO_CT = 80000;
// Net amount for the GWG limit: the price as paid includes 19 % VAT unless the house deducts input tax (then it is net).
const netto = (preisCt, mitVorsteuer) => (mitVorsteuer ? preisCt : Math.round(preisCt / 1.19));

// Write-off of one item in a year (cents): [AfA of the year, kind]. In the year of disposal the AfA runs up to the
// month of disposal; the remaining book value is deducted only when the item was scrapped (AfaA, § 7 Abs. 1 S. 7
// EStG) – a sale belongs to the private sphere and leaves it undeducted.
function afaPosten(x, jahr, mitVorsteuer = false) {
  if (!x.preis_ct || !x.kaufdatum || x.kategorie === 'haustechnik') return [0, null];
  const kaufjahr = Number(x.kaufdatum.slice(0, 4));
  const abgangsjahr = x.abgang_am ? Number(x.abgang_am.slice(0, 4)) : null;
  if (kaufjahr > jahr || (abgangsjahr && abgangsjahr < jahr)) return [0, null];
  const basis = x.preis_ct;
  if (netto(basis, mitVorsteuer) <= GWG_GRENZE_NETTO_CT) return [kaufjahr === jahr ? basis : 0, 'gwg'];
  const nd = Math.max(1, Number(x.nutzungsdauer_jahre) || 10);
  const voll = basis / nd;
  const kaufmonat = Number(x.kaufdatum.slice(5, 7));
  // Written off before the year: the first year by months (from the month of purchase), then full years.
  const bis = (j) => (j < kaufjahr ? 0 : Math.min(basis, Math.round(voll * (13 - kaufmonat) / 12 + voll * (j - kaufjahr))));
  const bisher = bis(jahr - 1);
  if (abgangsjahr === jahr) {
    if (x.abgang_art !== 'verkauft') return [Math.max(0, basis - bisher), 'abgang'];
    const monate = Number(x.abgang_am.slice(5, 7)) - (jahr === kaufjahr ? kaufmonat - 1 : 0);
    return [Math.max(0, Math.min(basis - bisher, Math.round(voll * monate / 12))), 'verkauf'];
  }
  return [Math.max(0, bis(jahr) - bisher), 'linear'];
}

// Book value at the end of a year.
function restwert(x, jahr, mitVorsteuer = false) {
  if (!x.preis_ct || !x.kaufdatum || x.kategorie === 'haustechnik') return null;
  let summe = 0;
  for (let j = Number(x.kaufdatum.slice(0, 4)); j <= jahr; j++) summe += afaPosten(x, j, mitVorsteuer)[0];
  return Math.max(0, x.preis_ct - summe);
}

module.exports = function inventar({ db, all, get, tx }) {
  const liste = (where, ...args) => {
    const jahr = Number(ortszeit.heute().slice(0, 4));
    return all(`SELECT i.*, e.bezeichnung AS einheit, d.datei AS rechnung_datei, d.titel AS rechnung_titel, f.datei AS foto_datei
      FROM inventar i LEFT JOIN einheiten e ON e.id = i.einheit_id LEFT JOIN dokumente d ON d.id = i.dokument_id AND d.status <> 'papierkorb'
      LEFT JOIN dokumente f ON f.id = i.foto_id AND f.status <> 'papierkorb'
      WHERE ${where} ORDER BY i.abgang_am IS NOT NULL, coalesce(e.nr, 0), i.bezeichnung`, ...args)
      .map((x) => ({ ...x, restwert_ct: restwert(x, jahr), gwg: x.preis_ct && x.kategorie !== 'haustechnik' ? netto(x.preis_ct, false) <= GWG_GRENZE_NETTO_CT : null }));
  };
  return {
    inventarKategorien: () => KATEGORIEN,
    inventar: (objektId, einheitId = null) => (einheitId ? liste('i.einheit_id = ?', einheitId) : liste('i.objekt_id = ?', objektId)),
    // The items of a unit with a warranty still running (shown with a case at that unit).
    inventarGarantie: (einheitId) => all(`SELECT id, bezeichnung, hersteller, modell, garantie_bis FROM inventar
      WHERE einheit_id = ? AND abgang_am IS NULL ORDER BY bezeichnung`, einheitId),
    // Data from an invoice in the inbox or archive: date, amount, sender – the user adds what is missing.
    inventarAusRechnung: (dokumentId) => {
      const d = get('SELECT id, objekt_id, einheit_id, datum, betrag_ct, absender, titel FROM dokumente WHERE id = ?', dokumentId);
      if (!d) throw new Error('Das Dokument gibt es nicht mehr.');
      return { objekt_id: d.objekt_id, einheit_id: d.einheit_id, kaufdatum: d.datum, preis_ct: d.betrag_ct, hersteller: d.absender, dokument_id: d.id, bezeichnung: d.titel };
    },
  };
};

Object.assign(module.exports, { KATEGORIEN, afaPosten, restwert, netto, GWG_GRENZE_NETTO_CT });
