import { useState } from 'react';
import { call, datum, euro, fehler, personName, type Row } from '../api';
import { alsPdf, bericht, esc, tabelle } from '../dokument';
import { bestaetigen, hinweis } from '../frage';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { useAktion } from '../aktion';
import { L, useNavi } from '../navi';
import { Chip, Leer, SortTh, sortiere, type Sortierung } from '../ui';

export const PERSON_FELDER: Field[] = [
  { key: 'anrede', label: 'Anrede', type: 'select', options: ['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'].map((a) => [a, a]) },
  { key: 'titel', label: 'Titel' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'firma', label: 'Firma', wide: true },
  { key: 'strasse', label: 'Straße', type: 'strasse', wide: true, section: 'Anschrift' },
  { key: 'plz', label: 'PLZ', type: 'plz', ort: 'ort' },
  { key: 'ort', label: 'Ort' },
  { key: 'land', label: 'Land' },
  { key: 'geburtsdatum', label: 'Geburtsdatum', type: 'date' },
  { key: 'telefon', label: 'Telefon', section: 'Kontakt' },
  { key: 'mobil', label: 'Mobil' },
  { key: 'email', label: 'E-Mail', wide: true },
  { key: 'kontoinhaber', label: 'Kontoinhaber', wide: true, section: 'Bankverbindung' },
  { key: 'iban', label: 'IBAN' },
  { key: 'bic', label: 'BIC' },
  { key: 'ust_id', label: 'USt-IdNr.', section: 'Firma (Rechnungen)' },
  { key: 'steuernr', label: 'Steuernummer' },
  { key: 'web', label: 'Website', wide: true },
  { key: 'notiz', label: 'Notiz', type: 'textarea', section: 'Sonstiges' },
];

// GDPR, Art. 15: a copy of everything the app holds about the person.
async function datenauskunft(id: number) {
  try {
    const d = await call('personDatenauskunft', id);
    const p = d.person;
    const stamm = tabelle(['Angabe', 'Wert'], [['Name', esc(personName(p))], ['Anschrift', esc([p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '))],
      ['Telefon', esc(p.telefon || p.mobil || '')], ['E-Mail', esc(p.email ?? '')], ['Geburtsdatum', datum(p.geburtsdatum)], ['IBAN', esc(p.iban ?? '')], ['Notiz', esc(p.notiz ?? '')]]);
    const vt = d.vertraege.length ? tabelle(['Art', 'Objekt', 'Einheit', 'Beginn', 'Ende'], d.vertraege.map((v: Row) => [v.art, esc(v.objekt), esc(v.einheit), datum(v.beginn), datum(v.ende)])) : '<p>keine</p>';
    const bu = d.buchungen.length ? tabelle(['Datum', 'Text', '#rBetrag'], d.buchungen.map((b: Row) => [datum(b.datum), esc(b.text ?? ''), `#r${euro(b.betrag_ct)}`])) : '<p>keine</p>';
    const dok = d.dokumente.length ? tabelle(['Datum', 'Art', 'Titel'], d.dokumente.map((x: Row) => [datum(x.datum), esc(x.typ ?? ''), esc(x.titel ?? '')])) : '<p>keine</p>';
    const it = d.interessent.length ? tabelle(['Einheit', 'Status', 'Personen', 'Einkommen', 'Beruf'], d.interessent.map((x: Row) => [esc(x.einheit), esc(x.status), x.personen ?? '', x.einkommen_ct ? euro(x.einkommen_ct) : '', esc(x.beruf ?? '')])) : '<p>keine</p>';
    await alsPdf([bericht('Auskunft über gespeicherte Daten (Art. 15 DSGVO)', `${personName(p)} · Stand ${datum(d.erstellt)}`,
      `<h2>Stammdaten</h2>${stamm}<h2>Verträge</h2>${vt}<h2>Buchungen auf Ihren Konten</h2>${bu}<h2>Dokumente</h2>${dok}<h2>Bewerbungen</h2>${it}
      <p class="klein">Zweck: Verwaltung der Miet- bzw. Eigentumsverhältnisse (Art. 6 Abs. 1 lit. b und c DSGVO). Empfänger: keine, außer Behörden oder Dienstleistern, soweit das Gesetz es verlangt. Speicherdauer: für die Dauer des Vertrags, danach bis zum Ende der gesetzlichen Aufbewahrungsfristen (bis zu zehn Jahre). Sie haben das Recht auf Berichtigung, Löschung, Einschränkung und Beschwerde bei einer Aufsichtsbehörde.</p>`)],
      `Datenauskunft ${personName(p)}`);
  } catch (e) { fehler(e); }
}

export function Personen() {
  const navi = useNavi();
  const [rows, reload] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [sort, setSort] = useState<Sortierung>({ key: 'name', ab: false });
  useAktion('neue-person', () => setEdit({ land: 'Deutschland' }));
  const [suche, setSuche] = useState(() => {
    // Set by the global search when it opens a person.
    const s = sessionStorage.getItem('personSuche') ?? '';
    sessionStorage.removeItem('personSuche');
    return s;
  });

  const q = suche.trim().toLowerCase();
  const treffer = sortiere(rows?.filter((p) =>
    !q || [p.vorname, p.nachname, p.firma, p.ort, p.email, p.telefon].some((v) => v?.toLowerCase().includes(q))), sort,
  (p, k) => (k === 'name' ? personName(p) : k === 'anschrift' ? p.ort : p[k]));

  return (
    <section>
      <div className="toolbar">
        <h1>Adressbuch</h1>
        <input className="suche" placeholder="Suchen…" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ land: 'Deutschland' })}>Neue Person</button>
      </div>
      <p className="hinweis klein">Das Adressbuch ist für Miet- und WEG-Verwaltung gemeinsam – eine Person kann Mieter und Eigentümer zugleich sein.</p>
      {rows && !rows.length && <Leer symbol="adressbuch" text="Noch keine Personen. Mieter, Eigentümer, Handwerker und Ansprechpartner stehen alle hier." aktion={<button className="primary" onClick={() => setEdit({ land: 'Deutschland' })}>Erste Person anlegen</button>} />}
      {!!rows?.length && <table>
        <thead>
          <tr><SortTh k="name" s={sort} set={setSort}>Name</SortTh><SortTh k="anschrift" s={sort} set={setSort}>Anschrift</SortTh><th>Telefon</th><SortTh k="email" s={sort} set={setSort}>E-Mail</SortTh><th>Rolle</th><th /></tr>
        </thead>
        <tbody>
          {treffer?.map((p) => (
            <tr key={p.id} className="klickbar" data-ziel={`person:${p.id}`} onClick={() => navi.zu({ person: p.id })} title="Steckbrief öffnen">
              <td><L zu={{ person: p.id }}>{personName(p)}</L></td>
              <td>{[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</td>
              <td>{p.telefon || p.mobil}</td>
              <td>{p.email}</td>
              <td>
                {p.anz_miete > 0 && <Chip art="miete">Mieter</Chip>}{' '}
                {p.anz_eigentum > 0 && <Chip art="weg">Eigentümer</Chip>}
              </td>
              <td className="aktionen">
                <button onClick={(e) => { e.stopPropagation(); datenauskunft(p.id); }} title="Auskunft über die gespeicherten Daten (Art. 15 DSGVO)">Auskunft</button>
                {!!p.anonymisierbar && <button onClick={async (e) => { e.stopPropagation(); if (await bestaetigen(`Alle Verträge von ${personName(p)} sind seit über zehn Jahren beendet. Name und Kontaktdaten jetzt löschen (anonymisieren)? Die Buchungen bleiben, ohne Namen. Das lässt sich nicht rückgängig machen.`, { ja: 'Anonymisieren' })) { await call('personAnonymisieren', p.id); hinweis('Die Person wurde anonymisiert.'); reload(); } }}>Anonymisieren</button>}
                <button onClick={(e) => { e.stopPropagation(); setEdit(p); }}>Bearbeiten</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>}
      {edit && (
        <FormDialog
          title={edit.id ? 'Person bearbeiten' : 'Neue Person'}
          fields={PERSON_FELDER}
          row={edit}
          onSave={async (r) => {
            if (!r.nachname && !r.firma) throw new Error('Bitte Nachname oder Firma angeben.');
            return call('save', 'personen', r);
          }}
          onDelete={() => call('remove', 'personen', edit.id)}
          onClose={() => {
            setEdit(null);
            reload();
          }}
        />
      )}
    </section>
  );
}
