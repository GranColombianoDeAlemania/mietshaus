// Shopping list – of a project, or of everything (Aufgaben → Einkaufen). One field „Was brauchst du?“ (a known article
// gets the shop it was bought in), the articles bought before to add with one tap, the list by shop. Ticking an article
// off in the shop only puts it in the cart; at the till one receipt for the whole cart – one amount, one photo – becomes
// one paid invoice per project. The articles are tasks of the kind „Einkauf“, so they are on the task list too and work
// offline.
import { useEffect, useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, fehler, heute, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Fenster, FensterTitel } from '../ui';
import { handy } from '../Foto';
import { dokUrl } from './Archiv';
import { DiktatKnopf } from '../Diktat';
import { Aufgabenblatt, cent, euroFeld, wannText } from './Aufgabenblatt';

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

export function ProjektEinkauf(props: { projekt: Row }) {
  return (
    <section className="einkauf">
      <div className="toolbar"><h1>Einkaufen</h1></div>
      <EinkaufListe projekt={props.projekt} />
    </section>
  );
}

export function EinkaufListe(props: { projekt?: Row | null; onGeaendert?: () => void }) {
  const pid: number | null = props.projekt?.id ?? null;
  const [d, reload] = useLoad<Row>(() => call('einkaufsliste', pid), [pid]);
  const [vorschlaege, ladeVorschlaege] = useLoad<Row[]>(() => call('einkaufVorschlaege', pid, 8), [pid]);
  const [fehlt, ladeFehlt] = useLoad<Row[]>(() => (pid ? call('materialFehlt', pid, 3) : Promise.resolve([])), [pid]);
  const [projekte] = useLoad<Row[]>(() => (pid ? Promise.resolve([]) : call<Row[]>('projektListe').catch(() => [])), [pid]);
  // Across all projects: the project new articles go to (kept for the next visit).
  const [fuer, setFuer] = useState(() => lesen('einkauf_projekt') ?? '');
  const [text, setText] = useState('');
  const [offen, setOffen] = useState<Row | null>(null);
  const [bon, setBon] = useState<Row[] | null>(null);
  const [zeigeGekauft, setZeigeGekauft] = useState(false);
  // In the cart at once on a tap, before the server has answered.
  const [wagen, setWagen] = useState<Record<number, boolean>>({});
  useEffect(() => setWagen({}), [d]);
  const neuLaden = () => { reload(); ladeVorschlaege(); ladeFehlt(); props.onGeaendert?.(); };
  const zielProjekt = pid ?? (Number(fuer) || null);

  async function hinzu(titel: string, extra: Row = {}) {
    if (!titel.trim()) return;
    try {
      await call('einkaufNeu', zielProjekt, { titel: titel.trim(), ...extra });
      neuLaden();
    } catch (e) { fehler(e); }
  }
  const imWagen = (v: Row) => wagen[v.id] ?? !!v.im_wagen;
  async function haken(v: Row) {
    const an = !imWagen(v);
    setWagen((w) => ({ ...w, [v.id]: an }));
    try { await call('einkaufWagen', v.id, an); reload(); } catch (e) { fehler(e); setWagen((w) => ({ ...w, [v.id]: !an })); }
  }

  const liste: Row[] = d?.liste ?? [];
  const offene = liste.filter((v) => v.status !== 'erledigt');
  const gekauft = liste.filter((v) => v.status === 'erledigt');
  const laeden = [...new Set(offene.map((v) => v.laden ?? ''))];
  const geschaetzt = offene.filter((v) => !imWagen(v)).reduce((s, v) => s + (v.preis_ct ?? 0), 0);

  return (
    <div className="einkaufsliste">
      {d && !!offene.length && <p className="hinweis klein einkauf-stand">{offene.length} offen{geschaetzt ? ` · noch ca. ${euro(geschaetzt)}` : ''}</p>}
      {!!fehlt?.length && (
        <div className="hinweisbox klein">
          <I.TriangleAlert size={15} aria-hidden="true" /> Material fehlt noch für {fehlt.map((a) => `„${a.titel}“ (ab ${datum(a.beginn)})`).join(', ')}.
        </div>
      )}
      <form className="schnellfeld" onSubmit={(e) => { e.preventDefault(); hinzu(text); setText(''); }}>
        <I.Plus size={16} aria-hidden="true" />
        <input aria-label="Artikel hinzufügen" placeholder="Was brauchst du? z. B. 3 Sack Fliesenkleber" value={text} onChange={(e) => setText(e.target.value)} />
        <DiktatKnopf klein onText={(t) => setText(t)} />
        <button type="submit" className="icon" aria-label="Hinzufügen" title="Hinzufügen (Enter)" disabled={!text.trim()}><I.CornerDownLeft size={15} /></button>
      </form>
      {!pid && !!projekte?.filter((p) => p.status !== 'abgeschlossen').length && (
        <label className="klein einkauf-fuer">Neue Artikel für
          <select value={fuer} onChange={(e) => { setFuer(e.target.value); schreiben('einkauf_projekt', e.target.value); }}>
            <option value="">kein Projekt</option>
            {projekte.filter((p) => p.status !== 'abgeschlossen').map((p) => <option key={p.id} value={p.id}>{p.titel}</option>)}
          </select>
        </label>
      )}
      {!!vorschlaege?.length && (
        <div className="chips vorschlaege">
          <span className="klein hinweis">Schon mal gekauft:</span>
          {vorschlaege.map((x) => (
            <button key={x.titel} type="button" className="chip-knopf" title={[x.laden, x.preis_ct != null && `zuletzt ${euro(x.preis_ct)}`].filter(Boolean).join(' · ')}
              onClick={() => hinzu(x.titel, { menge: x.menge, laden: x.laden })}>+ {x.titel}</button>
          ))}
        </div>
      )}

      {d && !offene.length && (
        <p className="hinweis einkauf-leer"><I.ShoppingCart size={16} aria-hidden="true" /> Nichts zu kaufen. Was gebraucht wird, kommt oben ins Feld.</p>
      )}
      {laeden.map((l) => {
        const artikel = offene.filter((v) => (v.laden ?? '') === l).sort((a, b) => Number(imWagen(a)) - Number(imWagen(b)));
        const drin = artikel.filter(imWagen);
        const summe = artikel.filter((v) => !imWagen(v)).reduce((s, v) => s + (v.preis_ct ?? 0), 0);
        return (
          <section key={l} className="einkauf-gruppe" aria-label={l || 'Ohne Laden'}>
            <h3><span>{l || 'Ohne Laden'}</span>{!!summe && <span className="hinweis klein">ca. {euro(summe)}</span>}</h3>
            <ul className="einkauf-liste">
              {artikel.map((v) => {
                const an = imWagen(v);
                const meta = [v.schritt && `für ${v.schritt}`, !pid && v.projekt, v.faellig && `bis ${wannText(v.faellig)}`, v.beschreibung].filter(Boolean).join(' · ');
                return (
                  <li key={v.id} className={an ? 'im-wagen' : ''}>
                    <button type="button" className={`haken gross${an ? ' an' : ''}`} aria-pressed={an}
                      aria-label={`${v.menge ? `${v.menge} ` : ''}${v.titel}: ${an ? 'aus dem Wagen nehmen' : 'in den Wagen'}`} onClick={() => haken(v)}>
                      <I.Check size={15} strokeWidth={3} aria-hidden="true" /></button>
                    <button type="button" className="einkauf-text" onClick={() => setOffen(v)}>
                      <span className="einkauf-titel">{v.menge && <b>{v.menge} </b>}{v.titel}</span>
                      {meta && <span className="klein hinweis">{meta}</span>}
                    </button>
                    {v.preis_ct != null && <span className="num klein">{euro(v.preis_ct)}</span>}
                    {v.foto && <span className="einkauf-foto" style={{ backgroundImage: `url("${dokUrl(v.foto)}")` }} aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
            {!!drin.length && (
              <button type="button" className="bon-knopf" onClick={() => setBon(drin)}>
                <I.Receipt size={17} aria-hidden="true" /><span>Bezahlt: Kassenbon erfassen</span><span className="klein">{drin.length} im Wagen</span>
              </button>
            )}
          </section>
        );
      })}

      {!!gekauft.length && (
        <div className="einkauf-gruppe">
          <button type="button" className="link klein" aria-expanded={zeigeGekauft} onClick={() => setZeigeGekauft(!zeigeGekauft)}>
            {zeigeGekauft ? 'Gekauftes ausblenden' : `${gekauft.length} gekauft${pid ? '' : ' (letzte 30 Tage)'} anzeigen`}</button>
          {zeigeGekauft && (
            <ul className="einkauf-liste erledigt">
              {gekauft.map((v) => (
                <li key={v.id}>
                  <I.Check size={15} aria-hidden="true" />
                  <button type="button" className="einkauf-text" onClick={() => setOffen(v)}>
                    <span className="einkauf-titel">{v.menge && <b>{v.menge} </b>}{v.titel}</span>
                    <span className="klein hinweis">{[v.laden, !pid && v.projekt, v.geaendert_am && `gekauft ${datum(String(v.geaendert_am).slice(0, 10))}`].filter(Boolean).join(' · ')}</span>
                  </button>
                  {v.preis_ct != null && <span className="num klein">{euro(v.preis_ct)}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {offen && <Aufgabenblatt key={offen.id} v={offen} onClose={() => { setOffen(null); neuLaden(); }} onGeaendert={reload} />}
      {bon && <Kassenbon artikel={bon} onClose={(ok) => { setBon(null); if (ok) neuLaden(); }} />}
    </div>
  );
}

// Paid: the price of each article (its estimate to start with), the total of the receipt (the sum unless typed) and a
// photo of the receipt. Articles of several projects share the receipt by their prices.
export function Kassenbon(props: { artikel: Row[]; onClose: (ok: boolean) => void }) {
  const a = props.artikel;
  const laeden = [...new Set(a.map((v) => v.laden).filter(Boolean))];
  const [preise, setPreise] = useState<Record<number, string>>(() => Object.fromEntries(a.map((v) => [v.id, euroFeld(v.preis_ct)])));
  const [gesamt, setGesamt] = useState<string | null>(null);
  const [beleg, setBeleg] = useState<Row | null>(null);
  const [tag, setTag] = useState(heute());
  const [laeuft, setLaeuft] = useState(false);
  const summe = a.reduce((s, v) => s + (cent(preise[v.id] ?? '') ?? 0), 0);
  const projekte = new Set(a.map((v) => v.projekt_id).filter(Boolean));

  async function fotografieren() {
    const opt = { objekt_id: a[0].objekt_id ?? undefined, projekt_id: a.find((v) => v.projekt_id)?.projekt_id ?? undefined, vorgang_id: a[0].id, status: 'abgelegt', typ: 'Rechnung' };
    try {
      const r = await window.hv[handy() ? 'fotoAufnehmen' : 'dateienImportieren'](opt);
      if (r?.length) setBeleg({ id: r[0].id, name: r[0].name, vorschau: r[0].vorschau });
    } catch (e) { fehler(e); }
  }
  async function speichern() {
    setLaeuft(true);
    try {
      const p: Record<number, number> = {};
      for (const v of a) { const c = cent(preise[v.id] ?? ''); if (c != null) p[v.id] = c; }
      const betrag = gesamt != null && gesamt.trim() ? cent(gesamt) : summe || null;
      await call('einkaufAbschliessen', { ids: a.map((v) => v.id), betrag_ct: betrag, dokument_id: beleg?.id ?? null, datum: tag, preise: p });
      props.onClose(true);
    } catch (e) { fehler(e); setLaeuft(false); }
  }
  return (
    <Fenster onClose={() => props.onClose(false)}>
      <div className="dialog kassenbon">
        <FensterTitel>Kassenbon{laeden.length === 1 ? ` ${laeden[0]}` : ''}</FensterTitel>
        <p className="hinweis klein">
          {projekte.size ? 'Der Betrag steht danach als bezahlte Rechnung unter „Kosten & Budget“ des Projekts.' : 'Ohne Projekt wird nur abgehakt, der Preis bleibt am Artikel.'}
          {projekte.size > 0 && (projekte.size > 1 || a.some((v) => !v.projekt_id)) ? ' Gehören Artikel zu verschiedenen Projekten (oder zu keinem), wird der Bon nach den Artikelpreisen aufgeteilt.' : ''}
        </p>
        <ul className="bon-liste">
          {a.map((v) => (
            <li key={v.id}>
              <span>{v.menge && <b>{v.menge} </b>}{v.titel}</span>
              <input aria-label={`Preis ${v.menge ? `${v.menge} ` : ''}${v.titel} in Euro`} inputMode="decimal" placeholder="0,00" value={preise[v.id] ?? ''}
                onChange={(e) => setPreise({ ...preise, [v.id]: e.target.value })} />
            </li>
          ))}
          <li className="bon-gesamt">
            <label htmlFor="bon-gesamt">Gesamt laut Bon</label>
            <input id="bon-gesamt" inputMode="decimal" placeholder="0,00" value={gesamt ?? euroFeld(summe || null)} onChange={(e) => setGesamt(e.target.value)} />
          </li>
        </ul>
        <div className="knopfreihe">
          <button type="button" onClick={fotografieren}><I.Camera size={15} aria-hidden="true" /> {beleg ? 'Anderes Foto' : 'Bon fotografieren'}</button>
          {beleg && <span className="klein hinweis">{beleg.vorschau ? 'auf dem Gerät, wird übertragen' : 'abgelegt'}: {beleg.name}</span>}
          <span className="spacer" />
          <label className="klein">Gekauft am <input type="date" value={tag} onChange={(e) => setTag(e.target.value || heute())} /></label>
        </div>
        <div className="buttons">
          <span className="spacer" />
          <button type="button" onClick={() => props.onClose(false)}>Abbrechen</button>
          <button type="button" className="primary" disabled={laeuft} onClick={speichern}>Bezahlt</button>
        </div>
      </div>
    </Fenster>
  );
}
