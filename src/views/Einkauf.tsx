// Shopping list of a project: quick entry („3 Sack Fliesenkleber“), shop and estimated price, the step of the schedule
// it is for, a photo per item (the old part, the label); bought, the receipt becomes an invoice of the project. The items
// are tasks of the category „Einkauf“, so they are on the board too and work offline.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, fehler, parseZahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { FormDialog, type Field } from '../Form';
import { Dialog } from '../ui';
import { handy } from '../Foto';
import { dokUrl } from './Archiv';
import { DiktatKnopf } from '../Diktat';

export const einkaufFelder = (schritte: Row[]): Field[] => [
  { key: 'titel', label: 'Artikel', required: true, wide: true },
  { key: 'menge', label: 'Menge (z. B. 3 Sack, 12 m²)' },
  { key: 'laden', label: 'Laden / Händler' },
  { key: 'preis_ct', label: 'Geschätzter Preis', type: 'money' },
  ...(schritte.length ? [{ key: 'projektaufgabe_id', label: 'Für Arbeitsschritt', type: 'select', options: schritte.map((a) => [a.id, `${a.titel} (ab ${datum(a.beginn)})`]) } as Field] : []),
  { key: 'beschreibung', label: 'Notiz (Farbe, Größe, Artikelnummer …)', type: 'textarea' },
];

export function ProjektEinkauf(props: { projekt: Row }) {
  const p = props.projekt;
  const [d, reload] = useLoad<Row>(() => call('einkaufsliste', p.id), [p.id]);
  const [projekt] = useLoad<Row>(() => call('projekt', p.id), [p.id]);
  const [fehlt, ladeFehlt] = useLoad<Row[]>(() => call('materialFehlt', p.id, 3), [p.id]);
  const [neu, setNeu] = useState({ titel: '', laden: '', preis: '', schritt: '' });
  const [edit, setEdit] = useState<Row | null>(null);
  const [gekauft, setGekauft] = useState<Row | null>(null);
  const [zeigeErledigt, setZeigeErledigt] = useState(false);
  const schritte: Row[] = projekt?.aufgaben ?? [];
  const neuLaden = () => { reload(); ladeFehlt(); };

  async function hinzu() {
    if (!neu.titel.trim()) return;
    try {
      await call('einkaufNeu', p.id, { titel: neu.titel, laden: neu.laden || null, preis_ct: neu.preis ? Math.round((parseZahl(neu.preis) ?? 0) * 100) : null,
        projektaufgabe_id: neu.schritt ? Number(neu.schritt) : null });
      // Shop and step stay for the next item – a list is mostly written for one shop at a time.
      setNeu({ ...neu, titel: '', preis: '' });
      neuLaden();
    } catch (e) { fehler(e); }
  }

  async function foto(v: Row) {
    const opt = { objekt_id: v.objekt_id ?? undefined, projekt_id: p.id, vorgang_id: v.id, status: 'abgelegt', typ: 'Foto' };
    try {
      const r = await window.hv[handy() ? 'fotoAufnehmen' : 'dateienImportieren'](opt);
      if (r?.length) { await call('dokumentSpeichern', { id: r[0].id, titel: `Einkauf: ${v.titel}` }); reload(); }
    } catch (e) { fehler(e); }
  }

  const laeden = [...new Set((d?.liste ?? []).map((v: Row) => v.laden).filter(Boolean))] as string[];
  const offen: Row[] = (d?.liste ?? []).filter((v: Row) => v.status !== 'erledigt');
  const erledigt: Row[] = (d?.liste ?? []).filter((v: Row) => v.status === 'erledigt');
  const gruppen = [...new Set(offen.map((v) => v.laden ?? ''))];

  return (
    <section className="einkauf">
      <div className="toolbar">
        <h1>Einkaufen</h1>
        <span className="hinweis klein">{d ? `${d.offen} offen${d.offen_geschaetzt_ct ? ` · geschätzt ${euro(d.offen_geschaetzt_ct)}` : ''}` : ''}</span>
      </div>
      {!!fehlt?.length && (
        <div className="hinweisbox klein">
          <I.TriangleAlert size={15} aria-hidden="true" /> Material fehlt noch für {fehlt.map((a) => `„${a.titel}“ (ab ${datum(a.beginn)}, ${a.offen} offen)`).join(', ')}.
        </div>
      )}
      <form className="einkauf-neu" onSubmit={(e) => { e.preventDefault(); hinzu(); }}>
        <input aria-label="Artikel" placeholder="z. B. 3 Sack Fliesenkleber" value={neu.titel} onChange={(e) => setNeu({ ...neu, titel: e.target.value })} />
        <input aria-label="Laden" placeholder="Laden" list="einkauf-laeden" value={neu.laden} onChange={(e) => setNeu({ ...neu, laden: e.target.value })} />
        <datalist id="einkauf-laeden">{laeden.map((l) => <option key={l} value={l} />)}</datalist>
        <input aria-label="Geschätzter Preis in Euro" placeholder="Preis €" inputMode="decimal" value={neu.preis} onChange={(e) => setNeu({ ...neu, preis: e.target.value })} />
        {!!schritte.length && (
          <select aria-label="Für Arbeitsschritt" value={neu.schritt} onChange={(e) => setNeu({ ...neu, schritt: e.target.value })}>
            <option value="">für keinen Schritt</option>
            {schritte.map((a) => <option key={a.id} value={a.id}>für: {a.titel}</option>)}
          </select>
        )}
        <button className="primary" type="submit" disabled={!neu.titel.trim()}>Hinzufügen</button>
        <DiktatKnopf label="Sprechen" onText={(t) => setNeu((alt) => ({ ...alt, titel: t }))} />
      </form>

      {d && !offen.length && <p className="hinweis">Die Liste ist leer – alles gekauft.</p>}
      {gruppen.map((g) => (
        <div key={g} className="einkauf-gruppe">
          <h3>{g || 'Ohne Laden'}</h3>
          <ul className="einkauf-liste">
            {offen.filter((v) => (v.laden ?? '') === g).map((v) => (
              <li key={v.id}>
                <label className="einkauf-haken" title="Gekauft"><input type="checkbox" aria-label={`${v.titel} gekauft`} checked={false} onChange={() => setGekauft(v)} /></label>
                {v.foto ? <a href={dokUrl(v.foto)} target="_blank" rel="noreferrer" className="einkauf-foto" style={{ backgroundImage: `url("${dokUrl(v.foto)}")` }} aria-label={`Foto von ${v.titel}`} />
                  : <button className="einkauf-foto leer-foto" aria-label={`Foto zu ${v.titel} aufnehmen`} onClick={() => foto(v)}><I.Camera size={18} /></button>}
                <button className="einkauf-text" onClick={() => setEdit(v)}>
                  <b>{v.menge ? `${v.menge} ` : ''}{v.titel}</b>
                  <span className="klein hinweis">{[v.schritt && `für ${v.schritt}`, v.faellig && `bis ${datum(v.faellig)}`, v.beschreibung].filter(Boolean).join(' · ')}</span>
                </button>
                {v.preis_ct != null && <span className="num klein">{euro(v.preis_ct)}</span>}
                {!!v.foto && <button className="icon" aria-label={`Weiteres Foto zu ${v.titel}`} onClick={() => foto(v)}><I.Camera size={15} /></button>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!!erledigt.length && (
        <div className="einkauf-gruppe">
          <button className="link klein" onClick={() => setZeigeErledigt(!zeigeErledigt)}>{zeigeErledigt ? 'Gekauftes ausblenden' : `${erledigt.length} gekauft – anzeigen`}</button>
          {zeigeErledigt && <ul className="einkauf-liste erledigt">{erledigt.map((v) => (
            <li key={v.id}><I.Check size={15} aria-hidden="true" /><span className="einkauf-text"><b>{v.menge ? `${v.menge} ` : ''}{v.titel}</b>
              <span className="klein hinweis">{[v.laden, v.geaendert_am && `gekauft ${datum(String(v.geaendert_am).slice(0, 10))}`].filter(Boolean).join(' · ')}</span></span></li>
          ))}</ul>}
        </div>
      )}

      {edit && <FormDialog title={edit.titel} fields={einkaufFelder(schritte)} row={edit}
        onSave={(r) => call('save', 'vorgaenge', { ...r, id: edit.id, kategorie: 'Einkauf', projekt_id: p.id })}
        onDelete={() => call('remove', 'vorgaenge', edit.id)} onClose={() => { setEdit(null); neuLaden(); }} />}
      {gekauft && <Gekauft einkauf={gekauft} projekt={p} onClose={(ok) => { setGekauft(null); if (ok) neuLaden(); }} />}
    </section>
  );
}

// Bought: the price paid and, if wanted, a photo of the receipt – both go to the project's costs.
export function Gekauft(props: { einkauf: Row; projekt?: Row | null; onClose: (ok: boolean) => void }) {
  const v = props.einkauf;
  const [betrag, setBetrag] = useState(v.preis_ct != null ? (v.preis_ct / 100).toFixed(2).replace('.', ',') : '');
  const [bon, setBon] = useState<Row | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const mitProjekt = !!(props.projekt?.id ?? v.projekt_id);

  async function fotografieren() {
    const opt = { objekt_id: v.objekt_id ?? undefined, projekt_id: props.projekt?.id ?? v.projekt_id ?? undefined, vorgang_id: v.id, status: 'abgelegt', typ: 'Rechnung' };
    try {
      const r = await window.hv[handy() ? 'fotoAufnehmen' : 'dateienImportieren'](opt);
      if (r?.length) setBon({ id: r[0].id, name: r[0].name, vorschau: r[0].vorschau });
    } catch (e) { fehler(e); }
  }
  async function speichern() {
    setLaeuft(true);
    try {
      const ct = betrag.trim() ? Math.round((parseZahl(betrag) ?? 0) * 100) : null;
      await call('einkaufGekauft', v.id, { betrag_ct: ct, dokument_id: bon?.id ?? null });
      props.onClose(true);
    } catch (e) { fehler(e); setLaeuft(false); }
  }
  return (
    <Dialog titel={`Gekauft: ${v.menge ? `${v.menge} ` : ''}${v.titel}`} onClose={() => props.onClose(false)}
      aktionen={<button className="primary" disabled={laeuft} onClick={speichern}>Speichern</button>}>
      {mitProjekt ? <>
        <p className="hinweis klein">Mit Betrag oder Kassenbon steht der Einkauf als bezahlte Rechnung unter „Kosten & Budget“ des Projekts.</p>
        <div className="maske zwei">
          <label>Bezahlt (€)<input inputMode="decimal" value={betrag} onChange={(e) => setBetrag(e.target.value)} placeholder="z. B. 48,70" /></label>
          <div className="einkauf-bon">
            <button onClick={fotografieren}><I.Receipt size={15} /> {bon ? 'Anderen Bon' : 'Kassenbon fotografieren'}</button>
            {bon && <span className="klein">{bon.vorschau ? 'auf dem Gerät, wird übertragen' : 'abgelegt'}: {bon.name}</span>}
          </div>
        </div>
      </> : <p className="hinweis klein">Der Einkauf wird als erledigt markiert.</p>}
    </Dialog>
  );
}
