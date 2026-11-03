// Bank access of an object account via FinTS (electron/fints.cjs): set up once, then fetch the transactions into the
// bank import. The PIN is typed each time and only passes through to the bank; approval by pushTAN in the banking app
// (waited for here) or by entering a TAN.
import { Fenster, FensterTitel } from '../ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { call, fehler, fehlerText, type Row } from '../api';
import { anfrage } from '../bruecke';
import { useLoad } from '../useLoad';
import type { Umsatz } from '../bankformate';

const ANLEITUNG = 'https://github.com/GranColombianoDeAlemania/mietshaus/blob/master/ANLEITUNG-FINTS.md';
type Antwort = { fertig?: boolean; umsaetze?: Umsatz[]; iban?: string; vorgang?: string; wartet?: boolean;
  tan?: { text: string; entkoppelt: boolean; medium: string | null; bild: string | null };
  verfahren?: { id: number; name: string; entkoppelt: boolean; medien: string[] }[]; konten?: { iban: string; name: string }[] };
const fints = async (aktion: string, daten: Row = {}): Promise<Antwort & Row> => (await anfrage('/api/fints', { json: { aktion, ...daten } })).json();

export function BankAbruf(props: { objekt: Row; onUmsaetze: (u: Umsatz[]) => void }) {
  const [status, reload] = useLoad<Row>(() => fints('status', { objektId: props.objekt.id }), [props.objekt.id]);
  const [dialog, setDialog] = useState<'' | 'einrichten' | 'abrufen'>('');
  if (!status) return null;
  return (
    <>
      {status.eingerichtet
        ? <><button onClick={() => setDialog('abrufen')} title={`Konto ${status.iban}${status.zuletzt ? `, zuletzt ${new Date(status.zuletzt).toLocaleString('de-DE')}` : ''}`}>Von der Bank holen…</button>
          <button className="link klein" onClick={() => setDialog('einrichten')}>Bankzugang</button></>
        : <button onClick={() => setDialog('einrichten')}>Bankzugang einrichten…</button>}
      {dialog && <Dialog objekt={props.objekt} status={status} art={dialog} onClose={() => { setDialog(''); reload(); }}
        onUmsaetze={(u) => { setDialog(''); reload(); props.onUmsaetze(u); }} />}
    </>
  );
}

function Dialog(props: { objekt: Row; status: Row; art: 'einrichten' | 'abrufen'; onClose: () => void; onUmsaetze: (u: Umsatz[]) => void }) {
  const [f, setF] = useState<Row>({ blz: props.status.blz ?? '', url: props.status.url ?? '', kennung: '', pin: '', von: '', produkt: '' });
  const [antwort, setAntwort] = useState<Antwort | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState('');
  const [tan, setTan] = useState('');
  const offen = useRef(true);
  useEffect(() => () => { offen.current = false; }, []);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });

  // Every answer of the bank: done, or a question (TAN, approval, TAN method, account) that leads to the next step.
  async function schritt(p: Promise<Antwort>) {
    setLaeuft(true); setMeldung('');
    try {
      const a = await p;
      if (a.fertig && a.umsaetze) return props.onUmsaetze(a.umsaetze);
      if (a.fertig) { setAntwort(null); setMeldung(`Bankzugang eingerichtet für ${a.iban}.`); return; }
      setAntwort(a); setTan('');
      // pushTAN: ask again every few seconds until the approval in the banking app has arrived.
      if (a.tan?.entkoppelt && a.vorgang) setTimeout(() => { if (offen.current) schritt(fints('weiter', { vorgang: a.vorgang })); }, 4000);
    } catch (e) {
      setAntwort(null); setMeldung(fehlerText(e));
    } finally { setLaeuft(false); }
  }
  const abbrechen = () => { if (antwort?.vorgang) fints('abbrechen', { vorgang: antwort.vorgang }); offen.current = false; props.onClose(); };

  if (!props.status.produkt) return (
    <Rahmen titel="Kontoabruf" onClose={props.onClose}>
      <p><b>Registrierung ausstehend.</b> Banken beantworten nur Programme mit einer FinTS-Produktnummer der Deutschen Kreditwirtschaft.
        Die gibt es kostenlos; der Antrag dauert etwa zwei bis drei Wochen.</p>
      <p><button className="link" onClick={() => window.hv.extern(ANLEITUNG)}>Anleitung zum Antrag öffnen</button></p>
      <label className="block">Produktnummer (sobald sie da ist)<input value={f.produkt} onChange={(e) => set('produkt', e.target.value.trim())} /></label>
      <div className="buttons"><span className="spacer" />
        <button className="primary" disabled={!f.produkt} onClick={async () => {
          try { await call('setzeEinstellungen', { fints_produkt: f.produkt }); props.onClose(); } catch (e) { fehler(e); }
        }}>Speichern</button></div>
    </Rahmen>
  );

  return (
    <Rahmen titel={props.art === 'einrichten' ? `Bankzugang für ${props.objekt.bezeichnung}` : 'Umsätze von der Bank holen'} onClose={abbrechen}>
      {!antwort && props.art === 'einrichten' && (
        <>
          <p className="klein hinweis">Die Angaben stehen bei deiner Bank unter „Online-Banking mit Finanzsoftware“ (FinTS/HBCI). Kennung und PIN sind
            die deines Online-Bankings. Die Kennung wird verschlüsselt gespeichert, die <b>PIN nie</b> – sie wird bei jedem Abruf abgefragt.</p>
          <div className="grid">
            <label>Bankleitzahl<input inputMode="numeric" value={f.blz} onChange={(e) => set('blz', e.target.value.replace(/\D/g, ''))} /></label>
            <label>FinTS-Adresse der Bank<input placeholder="https://…" value={f.url} onChange={(e) => set('url', e.target.value.trim())} /></label>
            <label>Anmeldename / Kennung<input autoComplete="off" value={f.kennung} onChange={(e) => set('kennung', e.target.value)} /></label>
            <label>PIN<input type="password" autoComplete="off" value={f.pin} onChange={(e) => set('pin', e.target.value)} /></label>
          </div>
          <div className="buttons">
            {props.status.eingerichtet && <button className="danger" onClick={async () => { await fints('entfernen', { objektId: props.objekt.id }); props.onClose(); }}>Bankzugang entfernen</button>}
            <span className="spacer" />
            <button className="primary" disabled={laeuft || !f.blz || !f.url || !f.kennung || !f.pin}
              onClick={() => schritt(fints('einrichten', { objektId: props.objekt.id, blz: f.blz, url: f.url, kennung: f.kennung, pin: f.pin }))}>{laeuft ? 'Verbinde …' : 'Verbinden'}</button>
          </div>
        </>
      )}
      {!antwort && props.art === 'abrufen' && (
        <>
          <p className="klein hinweis">Konto {props.status.iban}{props.status.verfahren ? ` · Freigabe mit ${props.status.verfahren}` : ''}. Die PIN geht nur an die Bank und wird nicht gespeichert.</p>
          <div className="grid">
            <label>PIN<input type="password" autoComplete="off" autoFocus value={f.pin} onChange={(e) => set('pin', e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && f.pin && schritt(fints('abrufen', { objektId: props.objekt.id, pin: f.pin, von: f.von || null }))} /></label>
            <label>Umsätze ab (leer: was die Bank anbietet)<input type="date" value={f.von} onChange={(e) => set('von', e.target.value)} /></label>
          </div>
          <div className="buttons">
            <span className="spacer" />
            <button className="primary" disabled={laeuft || !f.pin} onClick={() => schritt(fints('abrufen', { objektId: props.objekt.id, pin: f.pin, von: f.von || null }))}>{laeuft ? 'Hole Umsätze …' : 'Umsätze holen'}</button>
          </div>
        </>
      )}
      {antwort?.verfahren && (
        <>
          <p>Wie gibst du Aufträge frei?</p>
          {antwort.verfahren.flatMap((v) => (v.medien.length > 1 ? v.medien.map((m) => ({ ...v, medium: m })) : [{ ...v, medium: v.medien[0] }])).map((v) => (
            <div key={`${v.id}-${v.medium ?? ''}`} className="buttons" style={{ marginTop: 6 }}>
              <button disabled={laeuft} onClick={() => schritt(fints('weiter', { vorgang: antwort.vorgang, verfahren: v.id, medium: v.medium ?? null }))}>
                {v.name}{v.medium ? ` – ${v.medium}` : ''}{v.entkoppelt ? ' (Freigabe in der App)' : ''}</button>
            </div>
          ))}
        </>
      )}
      {antwort?.konten && (
        <>
          <p>Welches Konto gehört zu {props.objekt.bezeichnung}?</p>
          {antwort.konten.map((k) => (
            <div key={k.iban} className="buttons" style={{ marginTop: 6 }}>
              <button disabled={laeuft} onClick={() => schritt(fints('weiter', { vorgang: antwort.vorgang, iban: k.iban }))}>{k.iban}{k.name ? ` – ${k.name}` : ''}</button>
            </div>
          ))}
        </>
      )}
      {antwort?.tan && (
        <>
          <p><b>{antwort.tan.entkoppelt ? 'Bitte in deiner Banking-App freigeben.' : 'Bitte die TAN eingeben.'}</b></p>
          <p className="klein" style={{ whiteSpace: 'pre-wrap' }}>{antwort.tan.text}</p>
          {antwort.tan.bild && <img src={antwort.tan.bild} alt="photoTAN" style={{ maxWidth: 240 }} />}
          {antwort.tan.entkoppelt
            ? <p className="hinweis">{antwort.wartet ? 'Noch nicht freigegeben – es wird weiter gewartet …' : 'Wartet auf die Freigabe …'}</p>
            : <div className="buttons">
              <input autoFocus inputMode="numeric" value={tan} onChange={(e) => setTan(e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && tan && schritt(fints('weiter', { vorgang: antwort.vorgang, tan }))} />
              <button className="primary" disabled={laeuft || !tan} onClick={() => schritt(fints('weiter', { vorgang: antwort.vorgang, tan }))}>Bestätigen</button>
            </div>}
        </>
      )}
      {meldung && <p className={/eingerichtet/.test(meldung) ? 'meldung' : 'fehlertext'}>{meldung}</p>}
    </Rahmen>
  );
}

function Rahmen(props: { titel: string; onClose: () => void; children: ReactNode }) {
  return (
    <Fenster onClose={props.onClose}>
      <div className="dialog">
        <FensterTitel>{props.titel}</FensterTitel>
        {props.children}
        <div className="buttons"><span className="spacer" /><button onClick={props.onClose}>Schließen</button></div>
      </div>
    </Fenster>
  );
}
