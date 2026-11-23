// Two worlds that never mix: "privat" (rented houses, one's own money and projects) and "weg" (the managed owners'
// associations, the management business with its own money and projects). Houses belong to a world by their kind
// (miete → privat, weg → weg, gemischt → both); projects and the finances carry their world in the column `bereich`;
// documents, cases, appointments and project tasks take the world of their house or project.
//
// The world the user is working in comes with every request (header X-Welt) and lies in temp.kontext, like the user
// and the device. Without one (Claude's tools, the calendar subscription, background jobs, tests) lists show both
// worlds. Linking two records of different worlds is refused always, whatever the view.
const WELTEN = ['privat', 'weg'];
const NAME = { privat: 'Privat', weg: 'WEG' };
// SQL: the world of the request (NULL = both), and the one new records get.
const KW = `(SELECT wert FROM temp.kontext WHERE schluessel = 'welt')`;
const NEU = `coalesce(${KW}, 'privat')`;
const weltVonArt = (art) => (art === 'weg' ? 'weg' : art === 'miete' ? 'privat' : art === 'gemischt' ? 'beide' : null);

// SQL conditions to append to a WHERE (no parameters, so they fit into any query).
// A house column (objekte.id) in the current world; a missing house counts as `ohne`.
const objektSql = (spalte, ohne = '1') => `(${KW} IS NULL OR CASE WHEN ${spalte} IS NULL THEN ${ohne} ELSE EXISTS (SELECT 1 FROM objekte wo WHERE wo.id = ${spalte}
  AND wo.art IN ('gemischt', CASE ${KW} WHEN 'weg' THEN 'weg' ELSE 'miete' END)) END)`;
const projektSql = (spalte, ohne = '1') => `(${KW} IS NULL OR CASE WHEN ${spalte} IS NULL THEN ${ohne} ELSE EXISTS (SELECT 1 FROM projekte wp WHERE wp.id = ${spalte} AND wp.bereich = ${KW}) END)`;
// A row with objekt_id and projekt_id (documents, cases, appointments): the project decides, else the house.
// ohne: rows with neither (unassigned documents of the inbox, loose cases) – shown in both worlds when '1'.
const zeileSql = (a, ohne = '1') => `(${KW} IS NULL OR CASE WHEN ${a}.projekt_id IS NOT NULL THEN ${projektSql(`${a}.projekt_id`)}
  WHEN ${a}.objekt_id IS NOT NULL THEN ${objektSql(`${a}.objekt_id`)} ELSE ${ohne} END)`;

// Documents without house and project: in both worlds, unless sorted to one (dokumente.welt).
const dokumentOhne = (a) => `(${a}.welt IS NULL OR ${a}.welt = ${KW})`;

module.exports = function welt({ get }) {
  const aktuelle = () => get(`SELECT ${KW} AS w`)?.w ?? null;

  // The world of a record: 'privat', 'weg', 'beide' (a mixed house) or null (not bound to a world).
  function von(art, id) {
    if (id == null || id === '') return null;
    switch (art) {
      case 'objekt': return weltVonArt(get('SELECT art FROM objekte WHERE id = ?', id)?.art);
      case 'einheit': return von('objekt', get('SELECT objekt_id FROM einheiten WHERE id = ?', id)?.objekt_id);
      case 'konto': return von('objekt', get('SELECT objekt_id FROM konten WHERE id = ?', id)?.objekt_id);
      case 'buchung': return von('objekt', get('SELECT objekt_id FROM buchungen WHERE id = ?', id)?.objekt_id);
      case 'projekt': return get('SELECT bereich FROM projekte WHERE id = ?', id)?.bereich ?? null;
      case 'projektaufgabe': return von('projekt', get('SELECT projekt_id FROM projektaufgaben WHERE id = ?', id)?.projekt_id);
      case 'projektposten': return von('projekt', get('SELECT projekt_id FROM projektposten WHERE id = ?', id)?.projekt_id);
      case 'fin_konto': return get('SELECT bereich FROM fin_konten WHERE id = ?', id)?.bereich ?? null;
      case 'dokument': case 'vorgang': case 'termin': {
        const t = { dokument: 'dokumente', vorgang: 'vorgaenge', termin: 'termine' }[art];
        const r = get(`SELECT objekt_id, projekt_id${art === 'dokument' ? ', welt' : ''} FROM ${t} WHERE id = ?`, id);
        return r ? (r.projekt_id != null ? von('projekt', r.projekt_id) : r.objekt_id != null ? von('objekt', r.objekt_id) : r.welt ?? null) : null;
      }
      default: return null;
    }
  }

  // Refuses when the given records lie in different worlds. teile: [art, id] pairs; a mixed house fits both.
  function gleich(...teile) {
    const welten = new Set(teile.map(([art, id]) => von(art, id)).filter((w) => w === 'privat' || w === 'weg'));
    if (welten.size > 1) throw new Error('Das verbindet Einträge aus beiden Welten (Privat und WEG). Das geht nicht – ordne den Eintrag zuerst der richtigen Welt zu.');
  }
  // Refuses a record of the other world than the one being worked in (no world: everything is reachable).
  function zugriff(art, id) {
    const jetzt = aktuelle();
    const w = jetzt && von(art, id);
    if (w && w !== 'beide' && w !== jetzt) throw new Error(`Dieser Eintrag gehört zur Welt ${NAME[w]}. Wechsle oben links die Welt, um ihn zu öffnen.`);
  }
  // The world a new project or account gets: that of its house, else the current one, else private.
  const fuerNeu = (objektId) => {
    const w = von('objekt', objektId);
    return w === 'privat' || w === 'weg' ? w : (aktuelle() ?? 'privat');
  };

  return { aktuelle, von, gleich, zugriff, fuerNeu };
};
Object.assign(module.exports, { WELTEN, NAME, KW, NEU, objektSql, projektSql, zeileSql, dokumentOhne, weltVonArt });
