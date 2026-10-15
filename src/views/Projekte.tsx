// Projects mode: overview with year plan, project list, schedule (Gantt), costs and budget, documents.
import { useState } from 'react';
import { betrag, call, datum, diesesJahr, euro, fehler, heute, personName, type Row } from '../api';
import { useLoad } from '../useLoad';
import { FormDialog, type Field } from '../Form';
import { Gantt, type GanttZeile } from '../Gantt';
import { Tabs } from '../ui';
import { DokumentDialog } from './Archiv';
import { Galerie } from '../Galerie';

export const PROJEKT_STATUS: [string, string][] = [['planung', 'in Planung'], ['laufend', 'läuft'], ['pausiert', 'pausiert'], ['abgeschlossen', 'abgeschlossen']];
const statusName = (s: string) => PROJEKT_STATUS.find(([k]) => k === s)?.[1] ?? s;

export function projektFelder(objekte: Row[], konten: Row[]): (r: Row) => Field[] {
  return (r) => [
    { key: 'titel', label: 'Projekt', required: true, wide: true },
    { key: 'status', label: 'Status', type: 'select', required: true, options: PROJEKT_STATUS },
    { key: 'budget_ct', label: 'Budget', type: 'money' },
    { key: 'beginn', label: 'Geplanter Beginn', type: 'date' },
    { key: 'ende', label: 'Geplantes Ende', type: 'date' },
    { key: 'objekt_id', label: 'Gehört zu Objekt (optional)', type: 'select', options: objekte.map((o) => [o.id, o.bezeichnung]), section: 'Abrechnung' },
    ...(r.objekt_id ? [{ key: 'kosten_konto_id', label: 'Rechnungen buchen auf Konto', type: 'select', options: konten.filter((k) => k.klasse === 'kosten').map((k) => [k.id, `${k.nr} ${k.bezeichnung}`]) } as Field] : []),
    { key: 'beschreibung', label: 'Beschreibung', type: 'textarea', section: 'Sonstiges' },
  ];
}

// Budget bar: invoiced, remaining orders (forecast) against the budget.
function BudgetBalken(props: { p: Row }) {
  const p = props.p;
  const basis = Math.max(p.budget_ct ?? 0, p.prognose_ct, 1);
  const pct = (ct: number) => `${Math.min(100, (ct / basis) * 100)}%`;
  const ueber = p.budget_ct && p.prognose_ct > p.budget_ct;
  return (
    <div className="budget" title={`Berechnet ${euro(p.rechnungen_ct)} · Prognose ${euro(p.prognose_ct)} · Budget ${euro(p.budget_ct)}`}>
      <span className="prognose" style={{ width: pct(p.prognose_ct) }} />
      <span className="ist" style={{ width: pct(p.rechnungen_ct) }} />
      {p.budget_ct ? <span className="marke" style={{ left: pct(p.budget_ct) }} /> : null}
      {ueber && <span className="ueber">+{euro(p.prognose_ct - p.budget_ct)} über Budget</span>}
    </div>
  );
}

export function ProjektCockpit(props: { oeffne: (seite: string, id?: number) => void }) {
  const [liste] = useLoad<Row[]>(() => call('projektListe'), []);
  const [jahr, setJahr] = useState(diesesJahr());
  const [plan] = useLoad<Row[]>(() => call('jahresplan', jahr), [jahr]);
  if (!liste) return null;
  const aktiv = liste.filter((p) => p.status !== 'abgeschlossen');
  return (
    <section>
      <div className="toolbar"><h1>Projekte – Cockpit</h1><span className="spacer" />
        <button className="primary" onClick={() => props.oeffne('projekte')}>Projekte verwalten</button></div>
      <div className="kacheln">
        <div className="kachel"><div className="wert">{aktiv.length}</div><div className="label">aktive Projekte</div></div>
        <div className="kachel"><div className="wert">{euro(aktiv.reduce((s, p) => s + (p.budget_ct ?? 0), 0))}</div><div className="label">Budget gesamt</div></div>
        <div className="kachel"><div className="wert">{euro(aktiv.reduce((s, p) => s + p.prognose_ct, 0))}</div><div className="label">Kostenprognose</div></div>
        <div className="kachel"><div className="wert">{euro(aktiv.reduce((s, p) => s + p.rechnungen_ct - p.bezahlt_ct, 0))}</div><div className="label">Rechnungen offen</div></div>
      </div>
      {aktiv.length > 0 && (
        <div className="panel">
          <h3>Laufende Projekte</h3>
          <table>
            <thead><tr><th>Projekt</th><th>Status</th><th>Objekt</th><th>Zeitraum</th><th className="num">Fortschritt</th><th style={{ width: '30%' }}>Budget</th></tr></thead>
            <tbody>
              {aktiv.map((p) => (
                <tr key={p.id} className="klickbar" onClick={() => props.oeffne('zeitplan', p.id)}>
                  <td><b>{p.titel}</b></td><td>{statusName(p.status)}</td><td>{p.objekt ?? <i>eigenständig</i>}</td>
                  <td className="klein">{datum(p.plan_beginn ?? p.beginn)} – {datum(p.plan_ende ?? p.ende)}</td>
                  <td className="num">{p.aufgaben ? `${p.fortschritt ?? 0} %` : '–'}</td>
                  <td><BudgetBalken p={p} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="panel">
        <div className="toolbar">
          <h3>Jahresplan {jahr}</h3>
          <button onClick={() => setJahr(jahr - 1)}>‹</button><button onClick={() => setJahr(jahr + 1)}>›</button>
          <span className="hinweis klein">automatisch aus Abrechnungsfristen, Versammlungen, Mietenden und Projekten</span>
        </div>
        {plan && <Gantt von={`${jahr}-01-01`} bis={`${jahr}-12-31`}
          zeilen={plan.map((z, i) => ({ ...z, id: i, art: z.art } as GanttZeile))}
          onKlick={(z: any) => z.projekt_id && props.oeffne('zeitplan', z.projekt_id)} />}
      </div>
    </section>
  );
}

export function ProjektListe(props: { reload: () => void; oeffne: (seite: string, id?: number) => void }) {
  const [liste, reload] = useLoad<Row[]>(() => call('projektListe'), []);
  const [objekte] = useLoad<Row[]>(async () => [...new Map([...await call('objekte', 'miete'), ...await call('objekte', 'weg')].map((o: Row) => [o.id, o])).values()], []);
  const [edit, setEdit] = useState<Row | null>(null);
  const [konten] = useLoad<Row[]>(async () => (edit?.objekt_id ? call('konten', edit.objekt_id) : []), [edit?.objekt_id]);
  return (
    <section>
      <div className="toolbar"><h1>Projekte</h1><span className="spacer" />
        <button className="primary" onClick={() => setEdit({ status: 'planung', beginn: heute() })}>Neues Projekt</button></div>
      <p className="hinweis klein">Projekte stehen für sich (z. B. eigene Renovierung) oder gehören zu einem Objekt – dann werden ihre Rechnungen in dessen Buchhaltung gebucht, z. B. als Instandhaltung aus der Rücklage.</p>
      <table>
        <thead><tr><th>Projekt</th><th>Status</th><th>Objekt</th><th className="num">Budget</th><th className="num">Berechnet</th><th className="num">Prognose</th><th /></tr></thead>
        <tbody>
          {liste?.map((p) => (
            <tr key={p.id} className={p.status === 'abgeschlossen' ? 'inaktiv' : ''} onDoubleClick={() => setEdit(p)}>
              <td><b>{p.titel}</b></td><td>{statusName(p.status)}</td><td>{p.objekt ?? 'eigenständig'}</td>
              <td className="num">{p.budget_ct != null ? euro(p.budget_ct) : ''}</td><td className="num">{euro(p.rechnungen_ct)}</td>
              <td className={`num ${p.budget_ct && p.prognose_ct > p.budget_ct ? 'fehlertext' : ''}`}>{euro(p.prognose_ct)}</td>
              <td className="aktionen"><button onClick={() => props.oeffne('zeitplan', p.id)}>Öffnen</button><button onClick={() => setEdit(p)}>Bearbeiten</button></td>
            </tr>
          ))}
          {liste && !liste.length && <tr><td colSpan={7} className="hinweis">Noch keine Projekte.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Projekt bearbeiten' : 'Neues Projekt'} row={edit} fields={projektFelder(objekte ?? [], konten ?? [])}
        onSave={async (r) => {
          // Sensible default account when linked to an object: maintenance (from the reserve for WEG objects).
          if (r.objekt_id && !r.kosten_konto_id) {
            const ks: Row[] = await call('konten', r.objekt_id);
            const o = objekte?.find((x) => x.id === r.objekt_id);
            r.kosten_konto_id = (o?.art !== 'miete' ? ks.find((k) => k.aus_ruecklage) : null)?.id ?? ks.find((k) => k.kategorie === 'instandhaltung')?.id ?? null;
          }
          const id = await call('save', 'projekte', r);
          if (!edit.id) props.oeffne('zeitplan', id);
        }}
        onDelete={() => call('remove', 'projekte', edit.id)}
        onClose={() => { setEdit(null); reload(); props.reload(); }} />}
    </section>
  );
}

export function ProjektZeitplan(props: { projekt: Row }) {
  const [p, reload] = useLoad<Row>(() => call('projekt', props.projekt.id), [props.projekt.id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [edit, setEdit] = useState<Row | null>(null);
  if (!p) return null;
  const felder: Field[] = [
    { key: 'titel', label: 'Aufgabe', required: true, wide: true }, { key: 'gewerk', label: 'Gewerk / Firma' },
    { key: 'person_id', label: 'Verantwortlich', type: 'select', options: (personen ?? []).map((x) => [x.id, personName(x)]) },
    { key: 'beginn', label: 'Beginn', type: 'date', required: true }, { key: 'ende', label: 'Ende', type: 'date', required: true },
    { key: 'fortschritt', label: 'Fortschritt %', type: 'number' },
    { key: 'nach_id', label: 'Beginnt nach', type: 'select', options: p.aufgaben.filter((a: Row) => a.id !== edit?.id).map((a: Row) => [a.id, a.titel]) },
    { key: 'meilenstein', label: 'Meilenstein (ein Tag, z. B. Abnahme)', type: 'check' }, { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const letzte = p.aufgaben.at(-1);
  return (
    <section>
      <div className="toolbar">
        <h1>{p.titel}</h1><span className="tag">{statusName(p.status)}</span>
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ beginn: letzte ? naechsterTag(letzte.ende) : p.beginn ?? heute(), ende: letzte ? naechsterTag(letzte.ende, 7) : naechsterTag(heute(), 7), fortschritt: 0, nach_id: letzte?.id, sort: p.aufgaben.length })}>Aufgabe hinzufügen</button>
      </div>
      <div className="kacheln">
        <div className="kachel"><div className="wert">{p.fortschritt ?? 0} %</div><div className="label">Fortschritt</div></div>
        <div className="kachel"><div className="wert">{datum(p.plan_ende ?? p.ende) || '–'}</div><div className="label">geplantes Ende</div></div>
        <div className="kachel"><div className="wert">{euro(p.prognose_ct)}</div><div className="label">Kostenprognose{p.budget_ct ? ` (Budget ${euro(p.budget_ct)})` : ''}</div><BudgetBalken p={p} /></div>
      </div>
      <div className="panel">
        <Gantt zeilen={p.aufgaben.map((a: Row) => ({ id: a.id, titel: a.titel, beginn: a.beginn, ende: a.ende, fortschritt: a.fortschritt, meilenstein: !!a.meilenstein,
          erledigt: a.fortschritt >= 100, nach: a.nach_id, art: 'aufgabe', info: a.gewerk }))} onKlick={(z) => setEdit(p.aufgaben.find((a: Row) => a.id === z.id))} />
      </div>
      {p.aufgaben.length > 0 && (
        <table>
          <thead><tr><th>Aufgabe</th><th>Gewerk</th><th>Beginn</th><th>Ende</th><th className="num">Fortschritt</th><th /></tr></thead>
          <tbody>
            {p.aufgaben.map((a: Row) => (
              <tr key={a.id} onDoubleClick={() => setEdit(a)}>
                <td>{a.meilenstein ? '◆ ' : ''}{a.titel}</td><td>{a.gewerk}</td><td>{datum(a.beginn)}</td><td>{datum(a.ende)}</td><td className="num">{a.fortschritt} %</td>
                <td className="aktionen">
                  <button title="Diese und alle folgenden Aufgaben eine Woche früher" onClick={async () => { await call('aufgabeVerschieben', a.id, -7); reload(); }}>−1 Wo.</button>
                  <button title="Diese und alle folgenden Aufgaben eine Woche später" onClick={async () => { await call('aufgabeVerschieben', a.id, 7); reload(); }}>+1 Wo.</button>
                  <button onClick={async () => { await call('save', 'projektaufgaben', { id: a.id, fortschritt: 100 }); reload(); }}>✓</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && <FormDialog title={edit.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'} row={edit} fields={felder}
        onSave={async (r) => {
          if (r.ende < r.beginn) throw new Error('Das Ende liegt vor dem Beginn.');
          if (r.meilenstein) r.ende = r.beginn;
          r.fortschritt = Math.max(0, Math.min(100, Number(r.fortschritt) || 0));
          return call('save', 'projektaufgaben', { ...r, projekt_id: p.id });
        }}
        onDelete={() => call('remove', 'projektaufgaben', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
    </section>
  );
}

const naechsterTag = (iso: string, n = 1) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);

const ARTEN: [string, string][] = [['angebot', 'Angebot'], ['auftrag', 'Auftrag'], ['rechnung', 'Rechnung'], ['sonstiges', 'Sonstige Kosten']];

export function ProjektKosten(props: { projekt: Row }) {
  const [p, reload] = useLoad<Row>(() => call('projekt', props.projekt.id), [props.projekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [tab, setTab] = useState<'alle' | 'angebot' | 'auftrag' | 'rechnung'>('alle');
  const [dok, setDok] = useState<Row | null>(null);
  if (!p) return null;
  const felder = (r: Row): Field[] => [
    { key: 'art', label: 'Art', type: 'select', required: true, options: ARTEN },
    { key: 'datum', label: 'Datum', type: 'date' },
    { key: 'firma', label: 'Firma' }, { key: 'titel', label: 'Bezeichnung', required: true },
    { key: 'betrag_ct', label: 'Betrag (brutto)', type: 'money', required: true },
    { key: 'aufgabe_id', label: 'Gehört zu Aufgabe', type: 'select', options: p.aufgaben.map((a: Row) => [a.id, a.titel]) },
    ...(r.art === 'rechnung' ? [{ key: 'faellig', label: 'Fällig am', type: 'date' } as Field,
      { key: 'status', label: 'Status', type: 'select', required: true, options: [['offen', 'offen'], ['bezahlt', 'bezahlt']] } as Field,
      { key: 'bezahlt_am', label: 'Bezahlt am', type: 'date' } as Field] : []),
    ...(r.art === 'angebot' || r.art === 'auftrag' ? [{ key: 'status', label: 'Status', type: 'select', required: true,
      options: r.art === 'angebot' ? [['offen', 'offen'], ['angenommen', 'angenommen'], ['abgelehnt', 'abgelehnt']] : [['offen', 'erteilt'], ['abgeschlossen', 'abgeschlossen'], ['storniert', 'storniert']] } as Field] : []),
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const zeilen = p.posten.filter((x: Row) => tab === 'alle' || x.art === tab);
  return (
    <section>
      <div className="toolbar">
        <h1>Kosten & Budget – {p.titel}</h1>
        <Tabs tabs={[['alle', 'Alle'], ['angebot', 'Angebote'], ['auftrag', 'Aufträge'], ['rechnung', 'Rechnungen']]} value={tab} onChange={setTab} />
        <span className="spacer" />
        <button className="primary" onClick={() => setEdit({ art: tab === 'alle' ? 'rechnung' : tab, datum: heute(), status: 'offen' })}>Neuer Posten</button>
      </div>
      <div className="kacheln">
        <div className="kachel"><div className="wert">{p.budget_ct != null ? euro(p.budget_ct) : '–'}</div><div className="label">Budget</div></div>
        <div className="kachel"><div className="wert">{euro(p.auftraege_ct)}</div><div className="label">beauftragt</div></div>
        <div className="kachel"><div className="wert">{euro(p.rechnungen_ct)}</div><div className="label">berechnet ({euro(p.bezahlt_ct)} bezahlt)</div></div>
        <div className="kachel"><div className="wert">{euro(p.prognose_ct)}</div><div className="label">Prognose Endkosten</div><BudgetBalken p={p} /></div>
      </div>
      <p className="hinweis klein">
        {p.objekt ? `Rechnungen werden in der Buchhaltung von „${p.objekt}“ gebucht.` : 'Eigenständiges Projekt: Kosten werden nur hier geführt.'}
        {' '}Rechnungen und Angebote kannst du auch ins Postfach ziehen und in Claude „ordne das dem Projekt zu“ sagen.
      </p>
      <table>
        <thead><tr><th>Datum</th><th>Art</th><th>Firma</th><th>Bezeichnung</th><th className="num">Betrag</th><th>Status</th><th /></tr></thead>
        <tbody>
          {zeilen.map((x: Row) => (
            <tr key={x.id} onDoubleClick={() => setEdit(x)} className={x.status === 'storniert' || x.status === 'abgelehnt' ? 'inaktiv' : ''}>
              <td>{datum(x.datum)}</td><td>{ARTEN.find(([a]) => a === x.art)?.[1]}</td><td>{x.firma}</td><td>{x.titel}</td>
              <td className="num">{betrag(x.betrag_ct)}</td>
              <td>{x.buchung_id ? <span className="tag art-weg">gebucht</span> : x.status}{x.art === 'rechnung' && x.faellig && x.status === 'offen' && x.faellig < heute() ? <span className="tag fehlertext">überfällig</span> : null}</td>
              <td className="aktionen">
                {x.dokument_id && <button onClick={() => setDok({ id: x.dokument_id, datei: x.datei })}>Beleg</button>}
                {x.art === 'rechnung' && p.objekt_id && !x.buchung_id && <button onClick={async () => { try { await call('projektRechnungBuchen', x.id, null, x.bezahlt_am ?? heute()); reload(); } catch (e) { fehler(e); } }}>Buchen</button>}
              </td>
            </tr>
          ))}
          {!zeilen.length && <tr><td colSpan={7} className="hinweis">Keine Einträge.</td></tr>}
        </tbody>
      </table>
      {edit && <FormDialog title={edit.id ? 'Posten bearbeiten' : 'Neuer Posten'} row={edit} fields={felder}
        onSave={(r) => call('save', 'projektposten', { ...r, projekt_id: p.id })} onDelete={() => call('remove', 'projektposten', edit.id)}
        onClose={() => { setEdit(null); reload(); }} />}
      {dok && <DokumentDialog id={dok.id} datei={dok.datei} onClose={() => setDok(null)} />}
    </section>
  );
}

export function ProjektDokumente(props: { projekt: Row }) {
  return (
    <section>
      <div className="toolbar"><h1>Fotos & Dokumente – {props.projekt.titel}</h1></div>
      <p className="hinweis klein">Baustellenfotos, Angebote, Pläne und Rechnungen. Rechnungen und Angebote zusätzlich unter „Kosten & Budget“ erfassen – oder Claude sagen: „ordne die Rechnung dem Projekt zu“.</p>
      <Galerie filter={{ projekt_id: props.projekt.id }} hinweis={props.projekt.titel} />
    </section>
  );
}
