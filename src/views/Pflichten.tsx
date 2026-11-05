// Duties of a house (smoke detectors, boiler, legionella …): chosen from the catalogue – nothing ticked beforehand –,
// marked done with date and proof, which moves the next date on by the interval.
import { useState } from 'react';
import { call, datum, fehler, heute, personName, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { Liste } from '../Liste';
import { Chip, Dialog } from '../ui';
import type { Field } from '../Form';
import { handy } from '../Foto';
import { dokUrl } from './Archiv';
import { KATEGORIEN_KOSTEN } from './Konten';

const turnus = (m?: number | null) => (!m ? 'laut Bescheid' : m === 12 ? 'jährlich' : m % 12 === 0 ? `alle ${m / 12} Jahre` : `alle ${m} Monate`);

export const PFLICHT_ZUSTAND: Record<string, [string, 'rot' | 'gelb' | 'gruen' | undefined]> = {
  ueberfaellig: ['überfällig', 'rot'], bald: ['bald fällig', 'gelb'], ok: ['in Ordnung', 'gruen'], ohne_datum: ['ohne Termin', 'gelb'], pausiert: ['pausiert', undefined],
};

export function Pflichten(props: { objekt: Row }) {
  const [einheiten] = useLoad<Row[]>(() => call('einheiten', props.objekt.id), [props.objekt.id]);
  const [personen] = useLoad<Row[]>(() => call('personen'), []);
  const [katalog, setKatalog] = useState<(() => void) | null>(null);
  const [erledigen, setErledigen] = useState<{ p: Row; reload: () => void } | null>(null);
  const [verlauf, setVerlauf] = useState<Row | null>(null);

  const felder = (r: Row): Field[] => [
    { key: 'titel', label: 'Pflicht', required: true, wide: true },
    { key: 'einheit_id', label: 'Nur für Einheit (optional)', type: 'select', options: (einheiten ?? []).map((e) => [e.id, e.bezeichnung]) },
    { key: 'intervall_monate', label: 'Turnus in Monaten (leer = laut Bescheid)', type: 'number' },
    { key: 'naechste', label: 'Nächster Termin', type: 'date', required: !!r.aktiv },
    { key: 'vorlauf_tage', label: 'Vorgang so viele Tage vorher anlegen', type: 'number', required: true },
    { key: 'firma_id', label: 'Firma', type: 'select', options: (personen ?? []).map((p) => [p.id, personName(p)]) },
    { key: 'kategorie', label: 'Kostenart der Rechnung', type: 'select', options: KATEGORIEN_KOSTEN },
    { key: 'aktiv', label: 'Aktiv (pausiert: keine Vorgänge, keine Fristen)', type: 'check' },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];

  return (
    <>
      <Liste titel="Pflichten am Haus" table="pflichten" filter={{ objekt_id: props.objekt.id }} laden={() => call('pflichten', props.objekt.id)}
        neuLabel="Eigene Pflicht" neu={{ art: 'eigene', intervall_monate: 12, vorlauf_tage: 30, aktiv: 1, naechste: heute() }}
        hinweis="Wiederkehrende Prüfungen und Wartungen dieses Hauses. Vor jedem Termin entsteht ein Vorgang auf dem Board; mit „Erledigt“ legst du den Nachweis ab und der nächste Termin rückt weiter."
        kopf={(_, reload) => <button onClick={() => setKatalog(() => reload)}>Aus Katalog auswählen</button>}
        zeilenKlasse={(r) => (r.aktiv ? '' : 'inaktiv')}
        spalten={[
          ['Pflicht', (r) => <span>{r.titel}{r.einheit ? <span className="klein hinweis"> · {r.einheit}</span> : null}</span>],
          ['Turnus', (r) => turnus(r.intervall_monate)],
          ['Nächster Termin', (r) => datum(r.naechste)],
          ['Stand', (r) => { const [t, art] = PFLICHT_ZUSTAND[r.zustand] ?? [r.zustand, undefined]; return <Chip art={art}>{t}</Chip>; }],
          ['Zuletzt', (r) => datum(r.zuletzt)],
          ['Firma', (r) => (r.firma_id ? <L zu={{ person: r.firma_id }}>{r.firma}</L> : '')],
          ['Vorgang', (r) => (r.vorgang_id ? <L zu={{ vorgang: r.vorgang_id, objektId: r.objekt_id }}>offen</L> : '')],
        ]}
        aktionen={(r, reload) => (
          <>
            {!!r.aktiv && <button onClick={(e) => { e.stopPropagation(); setErledigen({ p: r, reload }); }}>Erledigt …</button>}
            <button onClick={(e) => { e.stopPropagation(); setVerlauf(r); }}>Verlauf</button>
          </>
        )}
        fields={felder} />
      {katalog && <KatalogDialog objekt={props.objekt} onClose={() => { katalog(); setKatalog(null); }} />}
      {erledigen && <PflichtErledigen pflicht={erledigen.p} onClose={(ok) => { if (ok) erledigen.reload(); setErledigen(null); }} />}
      {verlauf && <PflichtVerlauf pflicht={verlauf} onClose={() => setVerlauf(null)} />}
    </>
  );
}

// The catalogue as a list to tick: nothing is ticked beforehand, already chosen duties are shown as such.
function KatalogDialog(props: { objekt: Row; onClose: () => void }) {
  const [katalog] = useLoad<Row[]>(() => call('pflichtKatalog'), []);
  const [vorhanden] = useLoad<Row[]>(() => call('pflichten', props.objekt.id), [props.objekt.id]);
  const [wahl, setWahl] = useState<Record<string, string | null>>({});
  const [laeuft, setLaeuft] = useState(false);
  const aktiv = new Set((vorhanden ?? []).filter((p) => p.aktiv && !p.einheit_id).map((p) => p.art));
  const gewaehlt = Object.entries(wahl).filter(([, v]) => v !== null);

  async function anlegen() {
    setLaeuft(true);
    try {
      await call('pflichtenAnlegen', props.objekt.id, gewaehlt.map(([art, naechste]) => ({ art, naechste: naechste || undefined })));
      props.onClose();
    } catch (e) { fehler(e); setLaeuft(false); }
  }

  return (
    <Dialog titel={`Pflichten für ${props.objekt.bezeichnung} auswählen`} breit onClose={props.onClose}
      aktionen={<button className="primary" disabled={!gewaehlt.length || laeuft} onClick={anlegen}>{gewaehlt.length ? `${gewaehlt.length} anlegen` : 'Anlegen'}</button>}>
      <p className="hinweis klein">Hake an, was für dieses Haus gilt. Den ersten Termin kannst du gleich eintragen – ohne Angabe ist er in einem Monat, damit du ihn bald prüfst. Turnus, Firma und Kostenart änderst du danach in der Liste.</p>
      <div className="katalog">
        {(katalog ?? []).map((k) => {
          const an = wahl[k.art] !== undefined && wahl[k.art] !== null;
          return (
            <div key={k.art} className={`katalog-punkt${aktiv.has(k.art) ? ' inaktiv' : ''}`}>
              <label className="check">
                <input type="checkbox" checked={an} disabled={aktiv.has(k.art)} aria-label={k.titel}
                  onChange={(e) => setWahl({ ...wahl, [k.art]: e.target.checked ? '' : null })} />
                <b>{k.titel}</b> <span className="klein hinweis">· {turnus(k.monate)}{aktiv.has(k.art) ? ' · schon angelegt' : ''}</span>
              </label>
              <p className="klein hinweis">{k.hinweis}</p>
              {an && (
                <label className="klein">Erster Termin
                  <input type="date" value={wahl[k.art] ?? ''} onChange={(e) => setWahl({ ...wahl, [k.art]: e.target.value })} />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

// Done: date, proof (photo or file) and a note; without an interval the next date comes from the notice.
export function PflichtErledigen(props: { pflicht: Row; onClose: (ok: boolean) => void }) {
  const p = props.pflicht;
  const [tag, setTag] = useState(heute());
  const [notiz, setNotiz] = useState('');
  const [naechste, setNaechste] = useState('');
  const [nachweis, setNachweis] = useState<Row | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  async function ablegen(files?: FileList | null) {
    const opt = { objekt_id: p.objekt_id, einheit_id: p.einheit_id ?? undefined, status: 'abgelegt', typ: 'Protokoll' };
    try {
      const r = await (files ? window.hv.importieren(files, opt) : window.hv[handy() ? 'fotoAufnehmen' : 'dateienImportieren'](opt));
      if (!r?.length) return;
      const titel = `Nachweis ${p.titel} ${datum(tag)}`;
      await call('dokumentSpeichern', { id: r[0].id, titel, datum: tag });
      // Offline the file waits on this device; the preview shows it until then.
      setNachweis(r[0].offline ? { id: r[0].id, titel, datei: null, vorschau: r[0].vorschau } : await call('dokument', r[0].id));
    } catch (e) { fehler(e); }
  }

  async function speichern() {
    setLaeuft(true);
    try {
      await call('pflichtErledigen', p.id, { datum: tag, notiz: notiz || null, dokument_id: nachweis?.id ?? null, naechste: naechste || null });
      props.onClose(true);
    } catch (e) { fehler(e); setLaeuft(false); }
  }

  const ohneTurnus = !p.intervall_monate;
  return (
    <Dialog titel={`${p.titel} erledigt`} onClose={() => props.onClose(false)}
      aktionen={<button className="primary" disabled={laeuft || !tag || (ohneTurnus && !naechste)} onClick={speichern}>Speichern</button>}>
      <div className="maske zwei">
        <label>Erledigt am<input type="date" value={tag} max={heute()} onChange={(e) => setTag(e.target.value)} /></label>
        <label>{ohneTurnus ? 'Nächster Termin laut Bescheid' : 'Nächster Termin (leer = nach Turnus)'}
          <input type="date" value={naechste} onChange={(e) => setNaechste(e.target.value)} /></label>
        <label className="breit">Notiz<textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. alle Melder geprüft, Batterie in WE 3 getauscht" /></label>
      </div>
      <div className="toolbar">
        <button onClick={() => ablegen()}>{handy() ? 'Nachweis fotografieren' : 'Nachweis ablegen …'}</button>
        {nachweis && <span className="klein">{nachweis.datei ? 'Abgelegt' : 'Auf dem Gerät, wird übertragen'}: <a href={nachweis.datei ? dokUrl(nachweis.datei) : nachweis.vorschau} target="_blank" rel="noreferrer">{nachweis.titel}</a></span>}
      </div>
    </Dialog>
  );
}

function PflichtVerlauf(props: { pflicht: Row; onClose: () => void }) {
  const [rows] = useLoad<Row[]>(() => call('pflichtVerlauf', props.pflicht.id), [props.pflicht.id]);
  return (
    <Dialog titel={`Verlauf: ${props.pflicht.titel}`} onClose={props.onClose}>
      {props.pflicht.hinweis && <p className="hinweis klein">{props.pflicht.hinweis}</p>}
      {!rows?.length ? <p className="hinweis">Noch nicht als erledigt vermerkt.</p> : (
        <table>
          <thead><tr><th>Erledigt am</th><th>Nachweis</th><th>Notiz</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}><td>{datum(r.datum)}</td>
                <td>{r.datei ? <a href={dokUrl(r.datei)} target="_blank" rel="noreferrer">{r.dokument ?? r.dokument_name}</a> : <span className="hinweis">–</span>}</td>
                <td>{r.notiz}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
