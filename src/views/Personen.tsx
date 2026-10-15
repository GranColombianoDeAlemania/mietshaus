import { useState } from 'react';
import { call, personName, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';

const FELDER: Field[] = [
  { key: 'anrede', label: 'Anrede', type: 'select', options: ['Herr', 'Frau', 'Divers', 'Firma', 'Eheleute'].map((a) => [a, a]) },
  { key: 'titel', label: 'Titel' },
  { key: 'vorname', label: 'Vorname' },
  { key: 'nachname', label: 'Nachname' },
  { key: 'firma', label: 'Firma', wide: true },
  { key: 'strasse', label: 'Straße', wide: true, section: 'Anschrift' },
  { key: 'plz', label: 'PLZ' },
  { key: 'ort', label: 'Ort' },
  { key: 'land', label: 'Land' },
  { key: 'geburtsdatum', label: 'Geburtsdatum', type: 'date' },
  { key: 'telefon', label: 'Telefon', section: 'Kontakt' },
  { key: 'mobil', label: 'Mobil' },
  { key: 'email', label: 'E-Mail', wide: true },
  { key: 'kontoinhaber', label: 'Kontoinhaber', wide: true, section: 'Bankverbindung' },
  { key: 'iban', label: 'IBAN' },
  { key: 'bic', label: 'BIC' },
  { key: 'notiz', label: 'Notiz', type: 'textarea', section: 'Sonstiges' },
];

export function Personen() {
  const [rows, reload] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [suche, setSuche] = useState(() => {
    // Set by the global search when it opens a person.
    const s = sessionStorage.getItem('personSuche') ?? '';
    sessionStorage.removeItem('personSuche');
    return s;
  });

  const q = suche.trim().toLowerCase();
  const treffer = rows?.filter((p) =>
    !q || [p.vorname, p.nachname, p.firma, p.ort, p.email, p.telefon].some((v) => v?.toLowerCase().includes(q)));

  return (
    <section>
      <div className="toolbar">
        <h1>Adressbuch</h1>
        <input className="suche" placeholder="Suchen…" value={suche} onChange={(e) => setSuche(e.target.value)} />
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ land: 'Deutschland' })}>Neue Person</button>
      </div>
      <p className="hinweis klein">Das Adressbuch ist für Miet- und WEG-Verwaltung gemeinsam – eine Person kann Mieter und Eigentümer zugleich sein.</p>
      <table>
        <thead>
          <tr><th>Name</th><th>Anschrift</th><th>Telefon</th><th>E-Mail</th><th>Rolle</th></tr>
        </thead>
        <tbody>
          {treffer?.map((p) => (
            <tr key={p.id} onDoubleClick={() => setEdit(p)}>
              <td>{personName(p)}</td>
              <td>{[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</td>
              <td>{p.telefon || p.mobil}</td>
              <td>{p.email}</td>
              <td>
                {p.anz_miete > 0 && <span className="tag art-miete">Mieter</span>}
                {p.anz_eigentum > 0 && <span className="tag art-weg">Eigentümer</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && (
        <FormDialog
          title={edit.id ? 'Person bearbeiten' : 'Neue Person'}
          fields={FELDER}
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
