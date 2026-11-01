// Builds src/plz.json (postcode → places) from the GeoNames postal code file for Germany.
// Source: https://download.geonames.org/export/zip/DE.zip (CC BY 4.0, www.geonames.org). Run: node scripts/plz.cjs <DE.txt>
const fs = require('node:fs');
const path = require('node:path');

const plz = {};
for (const zeile of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  const [land, code, ort] = zeile.split('\t');
  if (land !== 'DE' || !/^\d{5}$/.test(code ?? '') || !ort) continue;
  // Districts come as "Berlin Mitte" or "Hamburg-Altona"; the postal town is enough for the address line.
  (plz[code] ??= new Set()).add(ort.trim());
}
const ohneStadtteile = (orte) => orte.filter((o) => !orte.some((x) => x !== o && (o.startsWith(`${x} `) || o.startsWith(`${x}-`))));
const aus = Object.fromEntries(Object.keys(plz).sort().map((k) => [k, ohneStadtteile([...plz[k]]).sort((a, b) => a.localeCompare(b, 'de'))]));
fs.writeFileSync(path.join(__dirname, '..', 'src', 'plz.json'), JSON.stringify(aus));
console.log(`${Object.keys(aus).length} Postleitzahlen`);
