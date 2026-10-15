// Digital hand-over protocol (move-in / move-out) and the tenant change assistant.
import { useEffect, useRef, useState } from 'react';
import * as I from 'lucide-react';
import { anrede, call, datum, euro, fehler, heute, parseZahl, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Dialog } from '../ui';
import { absenderAus, alsPdfAblegen, bericht, brief, esc, tabelle, absaetze, alsPdf } from '../dokument';
import { dokUrl } from './Archiv';
import { ZAEHLER_ARTEN } from './Zaehler';

const ZUSTAENDE: [string, string][] = [['gut', 'in Ordnung'], ['gebraucht', 'normale Abnutzung'], ['maengel', 'Mängel']];

// Signature pad: draw with mouse, trackpad or pen.
function Unterschrift(props: { wert?: string | null; onChange: (dataUrl: string | null) => void; titel: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zeichnet = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    c.width = c.clientWidth * 2;
    c.height = c.clientHeight * 2;
    const g = c.getContext('2d')!;
    g.scale(2, 2);
    g.lineWidth = 2.2; g.lineCap = 'round'; g.strokeStyle = '#111';
    if (props.wert) { const img = new Image(); img.onload = () => g.drawImage(img, 0, 0, c.clientWidth, c.clientHeight); img.src = props.wert; }
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 4 }}><b>{props.titel}</b><span className="spacer" />
        <button onClick={() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); props.onChange(null); }}>Löschen</button></div>
      <canvas ref={ref} className="unterschrift-feld"
        onPointerDown={(e) => { zeichnet.current = true; const g = ref.current!.getContext('2d')!; const [x, y] = pos(e); g.beginPath(); g.moveTo(x, y); ref.current!.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (!zeichnet.current) return; const g = ref.current!.getContext('2d')!; const [x, y] = pos(e); g.lineTo(x, y); g.stroke(); }}
        onPointerUp={() => { zeichnet.current = false; props.onChange(ref.current!.toDataURL('image/png')); }} />
    </div>
  );
}

export function UebergabeEditor(props: { id: number; onClose: () => void }) {
  const [u, setU] = useState<Row | null>(null);
  const [gespeichert, setGespeichert] = useState(true);
  useEffect(() => { call('uebergabe', props.id).then(setU); }, [props.id]);
  if (!u) return null;
  const fertig = !!u.abgeschlossen;
  const aendern = (x: Partial<Row>) => { setU({ ...u, ...x }); setGespeichert(false); };
  const raum = (i: number, x: Row) => aendern({ raeume: u.raeume.map((r: Row, j: number) => (j === i ? { ...r, ...x } : r)) });

  async function speichern() { await call('uebergabeSpeichern', u); setGespeichert(true); }

  async function fotoHinzu(i: number, files: FileList | null) {
    const r = await (files ? window.hv.importieren(files, { objekt_id: u!.einheit.objekt_id, einheit_id: u!.einheit_id, status: 'abgelegt', typ: 'Foto' })
      : window.hv.dateienImportieren({ objekt_id: u!.einheit.objekt_id, einheit_id: u!.einheit_id, status: 'abgelegt', typ: 'Foto' }));
    const docs = await Promise.all(r.map(async (x) => {
      await call('dokumentSpeichern', { id: x.id, titel: `${u!.art === 'einzug' ? 'Einzug' : 'Auszug'} ${u!.einheit.bezeichnung}: ${u!.raeume[i].name}`, typ: 'Foto', datum: u!.datum });
      return { id: x.id, datei: (await call('dokument', x.id)).datei };
    }));
    raum(i, { fotos: [...(u!.raeume[i].fotos ?? []), ...docs] });
  }

  function html() {
    const e = u!.einheit;
    const raeume = u!.raeume.filter((r: Row) => r.zustand || r.bemerkung || r.fotos?.length).map((r: Row) =>
      `<h2>${esc(r.name)} – ${esc(ZUSTAENDE.find(([k]) => k === r.zustand)?.[1] ?? 'nicht geprüft')}</h2>${r.bemerkung ? `<p>${esc(r.bemerkung)}</p>` : ''}
       ${(r.fotos ?? []).map((f: Row) => `<img src="${dokUrl(f.datei)}" style="width:48%;margin:0 1% 2mm 0;border-radius:2mm">`).join('')}`).join('');
    const zaehler = tabelle(['Zähler', 'Nummer', '#rStand'], u!.zaehler.map((z: Row) => [esc(ZAEHLER_ARTEN.find(([k]) => k === z.art)?.[1] ?? z.art), esc(z.nummer ?? ''), `#r${z.stand != null && z.stand !== '' ? zahl(Number(z.stand)) + ' ' + esc(z.masseinheit ?? '') : '–'}`]));
    const schluessel = tabelle(['Schlüssel', 'Nummer', `#r${u!.art === 'einzug' ? 'übergeben' : 'zurückgegeben'}`], u!.schluessel.map((s: Row) => [esc(s.bezeichnung), esc(s.nummer ?? ''), `#r${s.anzahl ?? 0}`]));
    // Both signature boxes have the same height so the lines align, with or without a signature.
    const sig = (t: string, d?: string) => `<div style="display:inline-block;width:46%;margin-right:4%;vertical-align:top"><div style="height:24mm;display:flex;align-items:flex-end">${d ? `<img src="${d}" style="max-height:24mm;max-width:100%">` : ''}</div><div style="border-top:0.5pt solid #333;font-size:8.5pt;padding-top:1mm">${t}</div></div>`;
    return bericht(`${u!.art === 'einzug' ? 'Einzugs' : 'Auszugs'}protokoll – Wohnungsübergabe`, `${e.objekt}, ${e.bezeichnung} · ${[e.strasse, e.plz, e.ort].filter(Boolean).join(' ')}`,
      `<p>Datum der Übergabe: <b>${datum(u!.datum)}</b>${u!.vertrag ? ` · Mieter: <b>${esc(u!.vertrag.name)}</b>` : ''}${u!.teilnehmer ? `<br>Anwesend: ${esc(u!.teilnehmer)}` : ''}</p>
       <h2>Zählerstände</h2>${zaehler}<h2>Schlüssel</h2>${schluessel}${raeume}${u!.notiz ? `<h2>Sonstiges</h2>${absaetze(u!.notiz)}` : ''}
       <p class="klein">Die Parteien bestätigen den oben beschriebenen Zustand der Wohnung.</p>
       <div style="margin-top:8mm">${sig('Mieter/in', u!.unterschrift_mieter)} ${sig('Vermieter/in bzw. Verwaltung', u!.unterschrift_vermieter)}</div>`);
  }

  async function abschliessen() {
    if (!u!.unterschrift_mieter && !confirm('Es fehlt die Unterschrift des Mieters. Trotzdem abschließen?')) return;
    try {
      await call('uebergabeSpeichern', u);
      const d = await alsPdfAblegen([html()], `${u!.art === 'einzug' ? 'Einzugs' : 'Auszugs'}protokoll ${u!.einheit.bezeichnung} ${u!.datum}`,
        { objekt_id: u!.einheit.objekt_id, einheit_id: u!.einheit_id, person_id: u!.vertrag?.person_id, typ: 'Protokoll', datum: u!.datum });
      await call('uebergabeAbschliessen', u!.id, d.id);
      await window.hv.dokumentOeffnen(d.datei);
      props.onClose();
    } catch (e) { fehler(e); }
  }

  return (
    <Dialog titel={`${u.art === 'einzug' ? 'Einzugs' : 'Auszugs'}übergabe – ${u.einheit.bezeichnung}${u.vertrag ? ` (${u.vertrag.name})` : ''}`} onClose={async () => { if (!gespeichert && !fertig) await speichern(); props.onClose(); }} breit
      aktionen={fertig ? <span className="meldung">Abgeschlossen – das Protokoll liegt im Archiv.</span> : <>
        <button onClick={speichern} disabled={gespeichert}>Zwischenspeichern</button>
        <button className="primary" onClick={abschliessen}>Abschließen & Protokoll erstellen</button></>}>
      <fieldset disabled={fertig} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="maske">
          <label>Datum<input type="date" value={u.datum} onChange={(e) => aendern({ datum: e.target.value })} /></label>
          <label className="breit">Anwesend<input value={u.teilnehmer ?? ''} placeholder="z. B. Herr Becker, Frau Muster (Verwaltung)" onChange={(e) => aendern({ teilnehmer: e.target.value })} /></label>
        </div>
        <h3>Räume</h3>
        {u.raeume.map((r: Row, i: number) => (
          <div key={i} className="raum">
            <div className="kopfzeile">
              <input value={r.name} onChange={(e) => raum(i, { name: e.target.value })} style={{ fontWeight: 700, border: 0, background: 'transparent', fontSize: 15 }} />
              <span className="spacer" />
              <span className="zustand">{ZUSTAENDE.map(([k, l]) => <button key={k} className={r.zustand === k ? 'gewaehlt' : ''} onClick={() => raum(i, { zustand: r.zustand === k ? '' : k })}>{l}</button>)}</span>
              <button className="icon" title="Foto hinzufügen" onClick={() => fotoHinzu(i, null)}><I.Camera size={15} /></button>
              <button className="icon" title="Raum entfernen" onClick={() => aendern({ raeume: u.raeume.filter((_: Row, j: number) => j !== i) })}><I.X size={15} /></button>
            </div>
            {(r.zustand === 'maengel' || r.bemerkung) && (
              <textarea rows={2} className="brieftext" style={{ marginTop: 6 }} placeholder="Mängel / Bemerkungen" value={r.bemerkung ?? ''} onChange={(e) => raum(i, { bemerkung: e.target.value })} />
            )}
            {r.zustand && r.zustand !== 'maengel' && !r.bemerkung && <button className="link" onClick={() => raum(i, { bemerkung: ' ' })}>Bemerkung hinzufügen</button>}
            {r.fotos?.length > 0 && <div className="galerie" style={{ marginTop: 8 }}>{r.fotos.map((f: Row) => (
              <div key={f.id} className="kachelbild"><div className="bild" style={{ backgroundImage: `url("${dokUrl(f.datei)}")`, height: 90 }} /></div>))}</div>}
            <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); window.dispatchEvent(new Event('hv-ziehen-aus')); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); fotoHinzu(i, e.dataTransfer.files); }} className="klein hinweis" style={{ marginTop: 4 }}>
              Fotos auch hierher ziehen.
            </div>
          </div>
        ))}
        <button onClick={() => aendern({ raeume: [...u.raeume, { name: 'Weiterer Raum', zustand: '', bemerkung: '', fotos: [] }] })}>+ Raum</button>
        <h3>Zählerstände</h3>
        {u.zaehler.length ? (
          <table><thead><tr><th>Zähler</th><th>Nummer</th><th className="num">Letzter Stand</th><th className="num">Stand heute</th></tr></thead>
            <tbody>{u.zaehler.map((z: Row, i: number) => (
              <tr key={z.zaehler_id}><td>{ZAEHLER_ARTEN.find(([k]) => k === z.art)?.[1] ?? z.art}</td><td>{z.nummer}</td><td className="num">{zahl(z.letzter)}</td>
                <td className="num"><input className="num zelle" value={z.stand ?? ''} onChange={(e) => aendern({ zaehler: u.zaehler.map((x: Row, j: number) => (j === i ? { ...x, stand: parseZahl(e.target.value) ?? e.target.value } : x)) })} /> {z.masseinheit}</td></tr>
            ))}</tbody></table>
        ) : <p className="hinweis">Für diese Einheit sind keine Zähler erfasst.</p>}
        <h3>Schlüssel</h3>
        {u.schluessel.length ? (
          <table><thead><tr><th>Schlüssel</th><th>Nummer</th><th className="num">{u.art === 'einzug' ? 'übergeben' : 'zurückgegeben'}</th></tr></thead>
            <tbody>{u.schluessel.map((s: Row, i: number) => (
              <tr key={s.schluessel_id}><td>{s.bezeichnung}</td><td>{s.nummer}</td>
                <td className="num"><input className="num zelle" style={{ width: 60 }} value={s.anzahl ?? 0} onChange={(e) => aendern({ schluessel: u.schluessel.map((x: Row, j: number) => (j === i ? { ...x, anzahl: Number(e.target.value) || 0 } : x)) })} /></td></tr>
            ))}</tbody></table>
        ) : <p className="hinweis">Keine Schlüssel im Objekt erfasst (Verwaltung → Schlüssel).</p>}
        <h3>Sonstiges</h3>
        <textarea rows={3} className="brieftext" value={u.notiz ?? ''} placeholder="z. B. Vereinbarungen zu Schönheitsreparaturen, Einbauten, Fristen" onChange={(e) => aendern({ notiz: e.target.value })} />
        <h3>Unterschriften</h3>
        <div className="zweispaltig" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Unterschrift titel="Mieter/in" wert={u.unterschrift_mieter} onChange={(d) => aendern({ unterschrift_mieter: d })} />
          <Unterschrift titel="Vermieter/in bzw. Verwaltung" wert={u.unterschrift_vermieter} onChange={(d) => aendern({ unterschrift_vermieter: d })} />
        </div>
      </fieldset>
    </Dialog>
  );
}

export function Uebergaben(props: { objekt: Row }) {
  const [liste, reload] = useLoad<Row[]>(() => call('uebergabenListe', props.objekt.id), [props.objekt.id]);
  const [wechsel, ladeWechsel] = useLoad<Row[]>(() => call('laufendeWechsel', props.objekt.id), [props.objekt.id]);
  const [vertraege] = useLoad<Row[]>(() => call('vertraege', 'mietverhaeltnisse', props.objekt.id), [props.objekt.id]);
  const [offen, setOffen] = useState<number | null>(null);
  const [assistent, setAssistent] = useState<number | null>(null);
  const [neu, setNeu] = useState<Row | null>(null);
  return (
    <section>
      <div className="toolbar"><h1>Übergaben & Mieterwechsel – {props.objekt.bezeichnung}</h1><span className="spacer" />
        <button className="primary" onClick={() => setNeu({ art: 'einzug', datum: heute() })}>Neue Übergabe</button></div>
      <h3>Mieterwechsel</h3>
      <p className="hinweis klein">Kündigung erhalten? Wähle den Mieter – der Assistent führt durch Vertragsende, Übergabe, Zählerstände, Kaution und Nachmieter.</p>
      <div className="toolbar">
        <select defaultValue="" onChange={(e) => e.target.value && setAssistent(Number(e.target.value))}>
          <option value="">Mieter wählen …</option>
          {vertraege?.filter((v) => v.aktuell).map((v) => <option key={v.id} value={v.id}>{v.einheit} – {v.name}</option>)}
        </select>
      </div>
      {wechsel && wechsel.length > 0 && (
        <table><thead><tr><th>Einheit</th><th>Mieter</th><th>Auszug</th><th>Fortschritt</th><th /></tr></thead>
          <tbody>{wechsel.map((w) => (
            <tr key={w.vertrag_id}><td>{w.einheit}</td><td>{w.name}</td><td>{datum(w.ende)}</td>
              <td>{Object.keys(w.schritte).length} von {SCHRITTE.length} Schritten</td>
              <td className="aktionen"><button onClick={() => setAssistent(w.vertrag_id)}>Öffnen</button></td></tr>
          ))}</tbody></table>
      )}
      <h3>Übergabeprotokolle</h3>
      <table>
        <thead><tr><th>Datum</th><th>Art</th><th>Einheit</th><th>Mieter</th><th>Status</th><th /></tr></thead>
        <tbody>
          {liste?.map((u) => (
            <tr key={u.id} className="klickbar" onClick={() => setOffen(u.id)}>
              <td>{datum(u.datum)}</td><td>{u.art === 'einzug' ? 'Einzug' : 'Auszug'}</td><td>{u.einheit}</td><td>{u.name}</td>
              <td>{u.abgeschlossen ? <span className="tag art-weg">abgeschlossen</span> : <span className="tag">in Bearbeitung</span>}</td>
              <td className="aktionen"><button onClick={(e) => { e.stopPropagation(); setOffen(u.id); }}>Öffnen</button></td>
            </tr>
          ))}
          {liste && !liste.length && <tr><td colSpan={6} className="hinweis">Noch keine Übergaben.</td></tr>}
        </tbody>
      </table>
      {neu && (
        <Dialog titel="Neue Übergabe" onClose={() => setNeu(null)} aktionen={
          <button className="primary" disabled={!neu.vertrag_id} onClick={async () => {
            const v = vertraege!.find((x) => x.id === neu.vertrag_id)!;
            const id = await call('uebergabeNeu', { einheit_id: v.einheit_id, vertrag_id: v.id, art: neu.art, datum: neu.datum });
            setNeu(null); reload(); setOffen(id);
          }}>Protokoll beginnen</button>}>
          <div className="maske zwei">
            <label>Art<select value={neu.art} onChange={(e) => setNeu({ ...neu, art: e.target.value })}><option value="einzug">Einzug</option><option value="auszug">Auszug</option></select></label>
            <label>Datum<input type="date" value={neu.datum} onChange={(e) => setNeu({ ...neu, datum: e.target.value })} /></label>
            <label className="breit">Mietverhältnis<select value={neu.vertrag_id ?? ''} onChange={(e) => setNeu({ ...neu, vertrag_id: Number(e.target.value) })}>
              <option value="">– wählen –</option>{vertraege?.map((v) => <option key={v.id} value={v.id}>{v.einheit} – {v.name} ({datum(v.beginn)}–{datum(v.ende)})</option>)}</select></label>
          </div>
        </Dialog>
      )}
      {offen && <UebergabeEditor id={offen} onClose={() => { setOffen(null); reload(); }} />}
      {assistent && <Mieterwechsel vertragId={assistent} objekt={props.objekt} onClose={() => { setAssistent(null); ladeWechsel(); reload(); }} oeffneUebergabe={(id) => { setAssistent(null); setOffen(id); }} />}
    </section>
  );
}

const SCHRITTE: [string, string][] = [
  ['kuendigung', 'Kündigung erfassen und bestätigen'], ['termin', 'Übergabetermin vereinbaren'], ['vorabnahme', 'Vorabbesichtigung (Schönheitsreparaturen, Mängel)'],
  ['uebergabe', 'Auszugsübergabe mit Protokoll und Zählerständen'], ['kaution', 'Kaution abrechnen'], ['nachmieter', 'Nachmieter finden / Mietvertrag'],
  ['einzug', 'Einzugsübergabe Nachmieter'], ['meldung', 'Wohnungsgeberbestätigung für den Nachmieter'],
];

function Mieterwechsel(props: { vertragId: number; objekt: Row; onClose: () => void; oeffneUebergabe: (id: number) => void }) {
  const [m, reload] = useLoad<Row>(() => call('mieterwechsel', props.vertragId), [props.vertragId]);
  const [w, setW] = useState<Row | null>(null);
  useEffect(() => { if (m) setW(m.wechsel ?? { kuendigung_eingang: heute(), kuendigung_durch: 'mieter', schritte: {} }); }, [m?.vertrag?.id]);
  if (!m || !w) return null;
  const v = m.vertrag;
  const erledigt = (k: string) => !!w.schritte[k];
  const setze = async (k: string, an = true) => {
    const neu = { ...w, schritte: { ...w.schritte, [k]: an ? heute() : undefined } };
    if (!an) delete neu.schritte[k];
    setW(neu);
    await call('mieterwechselSpeichern', props.vertragId, neu);
  };

  async function kuendigungSpeichern() {
    const ende = w!.ende_neu ?? (w!.kuendigung_durch === 'mieter' ? await call('mieterKuendigungsende', w!.kuendigung_eingang) : v.ende);
    if (!ende) return alert('Bitte das Vertragsende angeben.');
    await call('save', 'mietverhaeltnisse', { id: v.id, ende });
    await call('mieterwechselSpeichern', props.vertragId, { ...w, schritte: { ...w!.schritte, kuendigung: heute() } });
    reload();
  }

  async function bestaetigung() {
    const einst = await call('einstellungen');
    const p = await call('get', 'personen', v.person_id);
    await alsPdf([brief({ absender: absenderAus(einst), empfaenger: p, betreff: `Bestätigung Ihrer Kündigung – ${props.objekt.bezeichnung}, ${v.einheit}`,
      info: [['Objekt', props.objekt.bezeichnung], ['Einheit', v.einheit]],
      inhalt: `<p>${esc(anrede(p))}</p>${absaetze(`wir bestätigen den Eingang Ihrer Kündigung vom ${datum(w!.kuendigung_eingang)}. Das Mietverhältnis endet zum ${datum(v.ende)}.\n\nFür die Wohnungsübergabe melden wir uns mit einem Terminvorschlag. Bitte denken Sie an die Rückgabe aller Schlüssel. Die Kaution rechnen wir nach der Übergabe ab.`)}
        <p class="unterschrift">Mit freundlichen Grüßen<br><br>${esc(einst.verwalter_name ?? '')}</p>` })], `Kündigungsbestätigung ${v.name}`);
  }

  const auszug = m.uebergaben.find((u: Row) => u.art === 'auszug');
  const einzug = m.uebergaben.find((u: Row) => u.art === 'einzug');
  const aktion: Record<string, React.ReactNode> = {
    kuendigung: <div className="maske" style={{ marginTop: 6 }}>
      <label>Eingang der Kündigung<input type="date" value={w.kuendigung_eingang ?? ''} onChange={(e) => setW({ ...w, kuendigung_eingang: e.target.value, ende_neu: undefined })} /></label>
      <label>gekündigt durch<select value={w.kuendigung_durch ?? 'mieter'} onChange={(e) => setW({ ...w, kuendigung_durch: e.target.value })}>
        <option value="mieter">Mieter (3 Monate)</option><option value="vermieter">Vermieter</option><option value="einvernehmlich">Aufhebungsvertrag</option></select></label>
      <label>Vertragsende<input type="date" value={w.ende_neu ?? v.ende ?? ''} onChange={(e) => setW({ ...w, ende_neu: e.target.value })} /></label>
      <label>&nbsp;<span style={{ display: 'flex', gap: 6 }}><button onClick={kuendigungSpeichern}>Übernehmen</button>{v.ende && <button onClick={bestaetigung}>Bestätigung (PDF)</button>}</span></label>
    </div>,
    termin: <button onClick={async () => { await call('save', 'termine', { titel: `Wohnungsübergabe ${v.einheit} (${v.name})`, datum: v.ende ?? heute(), uhrzeit: '10:00', objekt_id: props.objekt.id, person_id: v.person_id }); setze('termin'); }}>Termin am Vertragsende anlegen</button>,
    uebergabe: auszug ? <button onClick={() => props.oeffneUebergabe(auszug.id)}>Auszugsprotokoll öffnen</button>
      : <button onClick={async () => props.oeffneUebergabe(await call('uebergabeNeu', { einheit_id: v.einheit_id, vertrag_id: v.id, art: 'auszug', datum: v.ende ?? heute() }))}>Auszugsprotokoll beginnen</button>,
    kaution: <span className="klein">Bestand {euro(m.kaution?.bestand ?? 0)}{m.konto_id ? ' · offene Forderungen werden unter „Kautionen“ verrechnet' : ''}</span>,
    nachmieter: m.nachmieter ? <span className="klein">Nachmieter: <b>{m.nachmieter.name}</b> ab {datum(m.nachmieter.beginn)}</span> : <span className="klein hinweis">Interessenten unter „Vermietung“ verwalten, dann Mietverhältnis anlegen.</span>,
    einzug: m.nachmieter ? (einzug ? <button onClick={() => props.oeffneUebergabe(einzug.id)}>Einzugsprotokoll öffnen</button>
      : <button onClick={async () => props.oeffneUebergabe(await call('uebergabeNeu', { einheit_id: v.einheit_id, vertrag_id: m.nachmieter.id, art: 'einzug', datum: m.nachmieter.beginn }))}>Einzugsprotokoll beginnen</button>) : null,
    meldung: <span className="klein hinweis">Unter „Briefe“ die Vorlage „Wohnungsgeberbestätigung“ wählen.</span>,
  };
  const automatisch: Record<string, boolean> = { uebergabe: !!auszug?.abgeschlossen, einzug: !!einzug?.abgeschlossen, nachmieter: !!m.nachmieter, kuendigung: !!v.ende && !!m.wechsel?.schritte?.kuendigung };

  return (
    <Dialog titel={`Mieterwechsel ${v.einheit} – ${v.name}`} onClose={props.onClose} breit>
      <p>Vertragsende: <b>{v.ende ? datum(v.ende) : 'noch nicht eingetragen'}</b></p>
      <ol className="schritte">
        {SCHRITTE.map(([k, l], i) => {
          const ok = erledigt(k) || automatisch[k];
          return (
            <li key={k} className={ok ? 'fertig' : ''}>
              <span className="nr">{ok ? <I.Check size={15} /> : i + 1}</span>
              <div className="inhalt"><b>{l}</b>{w.schritte[k] && <span className="klein hinweis"> · erledigt {datum(w.schritte[k])}</span>}<div>{aktion[k]}</div></div>
              <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setze(k, e.target.checked)} /> erledigt</label>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
