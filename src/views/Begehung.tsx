// Inspection of a house on the phone: area by area with state, photos and notes; a defect becomes a case with its photos,
// due duties are check points in their area. Every change is saved after a moment; completed, it is a PDF protocol.
import { useEffect, useRef, useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, fehler, heute, type Row } from '../api';
import { useLoad } from '../useLoad';
import { L } from '../navi';
import { Dialog } from '../ui';
import { handy } from '../Foto';
import { alsPdfAblegen, bericht, esc, absaetze } from '../dokument';
import { bestaetigen } from '../frage';
import { dokUrl } from './Archiv';
import { PflichtErledigen } from './Pflichten';
import { DiktatKnopf } from '../Diktat';
import { istOffline } from '../bruecke';
import { istVorlaeufig } from '../ausgang';

export function Begehungen(props: { objekt: Row }) {
  const [liste, reload] = useLoad<Row[]>(() => call('begehungen', props.objekt.id), [props.objekt.id]);
  const [offen, setOffen] = useState<number | null>(null);
  async function neu() {
    try { setOffen(await call<number>('begehungNeu', { objekt_id: props.objekt.id, datum: heute() })); } catch (e) { fehler(e); }
  }
  return (
    <section>
      <div className="toolbar"><h1>Begehungen</h1><span className="spacer" /><button className="primary" onClick={neu}>Neue Begehung</button></div>
      <p className="hinweis klein">Rundgang durch das Haus am Handy: Bereich für Bereich Zustand, Fotos und Notizen. Ein Mangel wird gleich ein Vorgang mit Foto; fällige Pflichten stehen als Prüfpunkte im passenden Bereich. Am Ende entsteht das Protokoll als PDF.</p>
      <table>
        <thead><tr><th>Datum</th><th>Anwesend</th><th className="num">Geprüft</th><th className="num">Mängel</th><th>Status</th></tr></thead>
        <tbody>
          {liste?.map((b) => (
            <tr key={b.id} className="klickbar" onClick={() => setOffen(b.id)}>
              <td>{datum(b.datum)}</td><td>{b.teilnehmer}</td><td className="num">{b.geprueft} / {b.anzahl}</td><td className="num">{b.maengel || ''}</td>
              <td>{b.abgeschlossen ? <span className="tag art-weg">abgeschlossen</span> : <span className="tag">in Bearbeitung</span>}</td>
            </tr>
          ))}
          {liste && !liste.length && <tr><td colSpan={5} className="hinweis">Noch keine Begehung.</td></tr>}
        </tbody>
      </table>
      {offen && <BegehungEditor id={offen} onClose={() => { setOffen(null); reload(); }} />}
    </section>
  );
}

const ZUSTAND: [string, string][] = [['ok', 'in Ordnung'], ['maengel', 'Mängel']];

export function BegehungEditor(props: { id: number; onClose: () => void }) {
  const [b, setB] = useState<Row | null>(null);
  const [gespeichert, setGespeichert] = useState(true);
  const [mangel, setMangel] = useState<number | null>(null);
  const [pflicht, setPflicht] = useState<Row | null>(null);
  // Without a connection the kept answer would be older than what was done here meanwhile – then the state here stays.
  const laden = () => (istOffline() && b ? Promise.resolve() : call<Row>('begehung', props.id).then((x) => { setB(x); setGespeichert(true); }));
  useEffect(() => { laden(); }, [props.id]);
  // Saved a moment after each change – on the phone a lost tab or a call must not cost the round.
  const zuletzt = useRef<Row | null>(null);
  useEffect(() => {
    if (!b || gespeichert || b.abgeschlossen) return;
    zuletzt.current = b;
    const t = setTimeout(() => speichern(b), 1200);
    return () => clearTimeout(t);
  }, [b, gespeichert]);
  if (!b) return null;
  const fertig = !!b.abgeschlossen;
  // Changes build on the latest state, so a photo arriving while typing does not undo the text (or the other way round).
  type Aenderung = Partial<Row> | ((alt: Row) => Partial<Row>);
  const aendern = (x: Aenderung) => { setB((alt) => (alt ? { ...alt, ...(typeof x === 'function' ? x(alt) : x) } : alt)); setGespeichert(false); };
  const bereich = (i: number, x: Row | ((r: Row) => Row)) => aendern((alt) => ({
    bereiche: alt.bereiche.map((r: Row, j: number) => (j === i ? { ...r, ...(typeof x === 'function' ? x(r) : x) } : r)),
  }));

  async function speichern(x: Row = b!) {
    // Previews of photos still on this device are not stored on the server.
    const ohneVorschau = { ...x, bereiche: x.bereiche.map((r: Row) => ({ ...r, fotos: (r.fotos ?? []).map(({ vorschau, ...f }: Row) => f) })) };
    try { await call('begehungSpeichern', ohneVorschau); if (zuletzt.current === x) setGespeichert(true); } catch (e) { fehler(e); }
  }

  async function foto(i: number, files: FileList | null) {
    const r0 = b!.bereiche[i];
    const opt = { objekt_id: b!.objekt_id, einheit_id: r0.einheit_id ?? undefined, status: 'abgelegt', typ: 'Foto' };
    try {
      const r = await (files ? window.hv.importieren(files, opt) : window.hv[handy() ? 'fotoAufnehmen' : 'dateienImportieren'](opt));
      const neu = await Promise.all((r ?? []).map(async (x) => {
        await call('dokumentSpeichern', { id: x.id, titel: `Begehung ${datum(b!.datum)}: ${r0.name}`, typ: 'Foto', datum: b!.datum });
        // Offline the photo has a provisional number and a preview from the device until it is sent.
        const datei = x.datei ?? (istVorlaeufig(x.id) ? null : (await call<Row>('dokument', x.id).catch(() => null))?.datei ?? null);
        return { id: x.id, datei, vorschau: x.vorschau };
      }));
      if (neu.length) bereich(i, (r) => ({ fotos: [...(r.fotos ?? []), ...neu] }));
    } catch (e) { fehler(e); }
  }

  function html() {
    const o = b!.objekt;
    const teile = b!.bereiche.filter((r: Row) => r.zustand || r.notiz?.trim() || r.fotos?.length || r.maengel?.length).map((r: Row) => `
      <h2>${esc(r.name)} – ${r.zustand === 'ok' ? 'in Ordnung' : r.zustand === 'maengel' ? 'Mängel' : 'nicht bewertet'}</h2>
      ${r.notiz?.trim() ? absaetze(r.notiz) : ''}
      ${r.maengel?.length ? `<ul>${r.maengel.map((m: Row) => `<li>${esc(m.text)} <span style="color:#777">(Vorgang #${m.vorgang_id})</span></li>`).join('')}</ul>` : ''}
      ${(r.fotos ?? []).map((f: Row) => `<img src="${dokUrl(f.datei)}" style="width:31%;margin:0 1% 2mm 0;border-radius:2mm">`).join('')}`).join('');
    const ohne = b!.bereiche.filter((r: Row) => !r.zustand).map((r: Row) => esc(r.name));
    return bericht('Protokoll der Begehung', `${o.bezeichnung} · ${[o.strasse, o.plz, o.ort].filter(Boolean).join(' ')}`,
      `<p>Datum: <b>${datum(b!.datum)}</b>${b!.teilnehmer ? ` · Anwesend: ${esc(b!.teilnehmer)}` : ''}</p>${teile}
       ${ohne.length ? `<p class="klein">Nicht bewertet: ${ohne.join(', ')}</p>` : ''}${b!.notiz ? `<h2>Sonstiges</h2>${absaetze(b!.notiz)}` : ''}`);
  }

  async function abschliessen() {
    const offen = b!.bereiche.filter((r: Row) => !r.zustand).length;
    if (offen && !await bestaetigen(`${offen} Bereiche sind noch nicht bewertet. Trotzdem abschließen?`, { ja: 'Abschließen' })) return;
    try {
      await call('begehungSpeichern', b);
      const d = await alsPdfAblegen([html()], `Begehung ${b!.objekt.bezeichnung} ${b!.datum}`, { objekt_id: b!.objekt_id, typ: 'Protokoll', datum: b!.datum });
      await call('begehungAbschliessen', b!.id, d.id);
      await window.hv.dokumentOeffnen(d.datei);
      props.onClose();
    } catch (e) { fehler(e); }
  }

  const geprueft = b.bereiche.filter((r: Row) => r.zustand).length;
  return (
    <Dialog titel={`Begehung ${b.objekt.bezeichnung} – ${datum(b.datum)}`} breit
      onClose={async () => { if (!gespeichert && !fertig) await speichern(); props.onClose(); }}
      aktionen={fertig ? <span className="meldung">Abgeschlossen – das Protokoll liegt im Archiv.</span> : <>
        <span className="klein hinweis">{gespeichert ? (istOffline() ? 'Auf dem Gerät gespeichert' : 'Gespeichert') : 'Speichert …'} · {geprueft} von {b.bereiche.length} geprüft</span>
        <button className="primary" onClick={abschliessen}>Abschließen & Protokoll</button></>}>
      <fieldset disabled={fertig} className="begehung">
        <div className="maske zwei">
          <label>Datum<input type="date" value={b.datum} onChange={(e) => aendern({ datum: e.target.value })} /></label>
          <label>Anwesend<input value={b.teilnehmer ?? ''} placeholder="z. B. Hausmeister Kraus" onChange={(e) => aendern({ teilnehmer: e.target.value })} /></label>
        </div>
        {b.bereiche.map((r: Row, i: number) => (
          <div key={i} className={`raum bereich${r.zustand ? ` z-${r.zustand}` : ''}`}>
            <div className="kopfzeile">
              <input className="bereich-name" value={r.name} aria-label="Bereich" onChange={(e) => bereich(i, { name: e.target.value })} />
              <span className="spacer" />
              <span className="zustand">{ZUSTAND.map(([k, l]) => <button key={k} className={r.zustand === k ? 'gewaehlt' : ''} onClick={() => bereich(i, (x) => ({ zustand: x.zustand === k ? '' : k }))}>{l}</button>)}</span>
            </div>
            {(r.pruefpunkte ?? []).map((p: Row) => (
              <div key={p.pflicht_id} className={`pruefpunkt${p.erledigt ? ' fertig' : ''}`}>
                <I.ClipboardCheck size={15} aria-hidden="true" /> <span>{p.titel}{p.naechste ? <span className="klein hinweis"> · fällig {datum(p.naechste)}</span> : null}</span>
                <span className="spacer" />
                {p.erledigt ? <span className="klein hinweis">erledigt</span>
                  : <button className="klein" onClick={async () => setPflicht(await call('get', 'pflichten', p.pflicht_id))}>Erledigt …</button>}
              </div>
            ))}
            <textarea rows={2} className="brieftext" placeholder="Notiz zu diesem Bereich" value={r.notiz ?? ''} onChange={(e) => bereich(i, { notiz: e.target.value })} />
            {r.fotos?.length > 0 && <div className="galerie begehung-fotos">{r.fotos.map((f: Row) => {
              const url = f.datei ? dokUrl(f.datei) : f.vorschau;
              return url ? <a key={f.id} href={url} target="_blank" rel="noreferrer" className="kachelbild"><div className="bild" style={{ backgroundImage: `url("${url}")` }} /></a>
                : <div key={f.id} className="kachelbild"><div className="bild leer klein hinweis">wird übertragen</div></div>;
            })}</div>}
            {r.maengel?.length > 0 && <ul className="maengel">{r.maengel.map((m: Row, j: number) => (
              <li key={j}><I.TriangleAlert size={14} aria-hidden="true" /> <L zu={{ vorgang: m.vorgang_id, objektId: b.objekt_id }}>{m.text}</L></li>))}</ul>}
            <div className="toolbar bereich-knoepfe">
              <button onClick={() => foto(i, null)}><I.Camera size={15} /> Foto</button>
              <button onClick={() => setMangel(i)}><I.TriangleAlert size={15} /> Mangel melden</button>
              <DiktatKnopf label="Notiz sprechen" onText={(text) => bereich(i, (x) => ({ notiz: [x.notiz?.trim(), text].filter(Boolean).join('\n') }))} />
            </div>
          </div>
        ))}
        <button onClick={() => aendern((alt) => ({ bereiche: [...alt.bereiche, { name: 'Weiterer Bereich', zustand: '', notiz: '', fotos: [], maengel: [], pruefpunkte: [] }] }))}>+ Bereich</button>
        <h3>Sonstiges</h3>
        <textarea rows={3} className="brieftext" value={b.notiz ?? ''} placeholder="z. B. Absprachen mit dem Hausmeister" onChange={(e) => aendern({ notiz: e.target.value })} />
      </fieldset>
      {mangel != null && <MangelDialog bereich={b.bereiche[mangel]} onClose={async (werte) => {
        const i = mangel;
        setMangel(null);
        if (!werte) return;
        try {
          if (!gespeichert) await speichern();
          const id = await call('begehungMangel', b.id, i, werte);
          // Offline: noted here at once (the case is created when the change reaches the server).
          if (istVorlaeufig(id)) bereich(i, (x) => ({ zustand: 'maengel', maengel: [...(x.maengel ?? []), { text: werte.text, vorgang_id: id, foto_ids: werte.foto_ids ?? [] }] }));
          else await laden();
        } catch (e) { fehler(e); }
      }} />}
      {pflicht && <PflichtErledigen pflicht={pflicht} onClose={(ok) => {
        const id = pflicht.id;
        setPflicht(null);
        if (!ok) return;
        if (istOffline()) aendern((alt) => ({ bereiche: alt.bereiche.map((r: Row) => ({ ...r, pruefpunkte: (r.pruefpunkte ?? []).map((p: Row) => (p.pflicht_id === id ? { ...p, erledigt: true } : p)) })) }));
        else laden();
      }} />}
    </Dialog>
  );
}

// A defect: short text, priority, the photos of the area to attach (the ones not yet attached are ticked) – or a whole
// damage workflow.
function MangelDialog(props: { bereich: Row; onClose: (werte?: Row) => void }) {
  const schonDran = new Set((props.bereich.maengel ?? []).flatMap((m: Row) => m.foto_ids ?? []));
  const [text, setText] = useState('');
  const [prio, setPrio] = useState(2);
  const [ablauf, setAblauf] = useState(false);
  const [fotos, setFotos] = useState<number[]>((props.bereich.fotos ?? []).map((f: Row) => f.id).filter((id: number) => !schonDran.has(id)));
  return (
    <Dialog titel={`Mangel: ${props.bereich.name}`} onClose={() => props.onClose()}
      aktionen={<button className="primary" disabled={!text.trim()} onClick={() => props.onClose({ text, prioritaet: prio, foto_ids: fotos, ablauf })}>Vorgang anlegen</button>}>
      <div className="maske zwei">
        <label className="breit">Was ist los?<textarea rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="z. B. Feuchtigkeit an der Kellerwand hinten links" /></label>
        <div className="breit"><DiktatKnopf onText={(t) => setText((alt) => [alt.trim(), t].filter(Boolean).join(' '))} /></div>
        <label>Dringlichkeit<select value={prio} onChange={(e) => setPrio(Number(e.target.value))}><option value={1}>dringend</option><option value={2}>normal</option><option value={3}>bei Gelegenheit</option></select></label>
        <label className="check"><input type="checkbox" checked={ablauf} onChange={(e) => setAblauf(e.target.checked)} /> als Schadensfall mit allen Schritten</label>
      </div>
      {props.bereich.fotos?.length > 0 && <>
        <p className="klein hinweis">Fotos zum Vorgang nehmen:</p>
        <div className="galerie begehung-fotos">{props.bereich.fotos.map((f: Row) => (
          <label key={f.id} className={`kachelbild waehlbar${fotos.includes(f.id) ? ' gewaehlt' : ''}`}>
            <input type="checkbox" checked={fotos.includes(f.id)} onChange={(e) => setFotos(e.target.checked ? [...fotos, f.id] : fotos.filter((x) => x !== f.id))} />
            <div className="bild" style={{ backgroundImage: `url("${f.datei ? dokUrl(f.datei) : f.vorschau ?? ''}")` }} />
          </label>))}</div>
      </>}
    </Dialog>
  );
}
