// German postcodes → places (src/plz.json from GeoNames, CC BY 4.0, www.geonames.org; built by scripts/plz.cjs).
// The table is loaded on first use, not with the app.
let tabelle: Promise<Record<string, string[]>> | null = null;

export async function orteZurPlz(plz: unknown): Promise<string[]> {
  const p = String(plz ?? '').trim();
  if (!/^\d{5}$/.test(p)) return [];
  tabelle ??= import('./plz.json').then((m) => m.default as Record<string, string[]>);
  return (await tabelle)[p] ?? [];
}
