// Letting: offer and exposé per vacant unit, applicants as a kanban board, self-disclosure form, acceptance.
import { useEffect, useState } from 'react';
import * as I from 'lucide-react';
import { call, datum, euro, fehler, heute, parseCent, zahl, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Dialog } from '../ui';
import { FormDialog, type Field } from '../Form';
import { absenderAus, alsPdf, bericht, esc, tabelle } from '../dokument';
import { dokUrl } from './Archiv';
import { sollNachfrage } from './Sollstellung';

const SPALTEN: [string, string][] = [['neu', 'Neu'], ['besichtigung', 'Besichtigung'], ['auskunft', 'Unterlagen da'], ['favorit', 'Favorit'], ['absage', 'Abgesagt']];
const cent2 = (ct?: number | null) => (ct == null ? '' : (ct / 100).toFixed(2).replace('.', ','));

export function Vermietung(props: { objekt: Row; oeffne: (seite: string, id?: number) => void }) {
  const [einheiten, reload] = useLoad<Row[]>(() => call('vermietung', props.objekt.id), [props.objekt.id]);
  const [eid, setEid] = useState<number | null>(null);
  useEffect(() => { if (einheiten && !einheiten.some((e) => e.id === eid)) setEid(einheiten[0]?.id ?? null); }, [einheiten]);
  const e = einheiten?.find((x) => x.id === eid);
  return (
    <section>
      <div className="toolbar"><h1>Vermietung</h1></div>
      {einheiten && !einheiten.length && <p className="hinweis">Keine Einheit ist frei oder wird in den nächsten 4 Monaten frei.</p>}
      {einheiten && einheiten.length > 0 && (
        <div className="tabs" style={{ marginBottom: 14 }}>
          {einheiten.map((x) => <button key={x.id} className={x.id === eid ? 'active' : ''} onClick={() => setEid(x.id)}>
            {x.bezeichnung}{x.letztes_ende && x.letztes_ende >= heute() ? ` (frei ab ${datum(x.letztes_ende)})` : ' (frei)'}{x.interessenten ? ` · ${x.interessenten}` : ''}</button>)}
        </div>
      )}
      {e && <EinheitVermietung key={e.id} einheit={e} objekt={props.objekt} reload={reload} oeffne={props.oeffne} />}
    </section>
  );
}

function EinheitVermietung(props: { einheit: Row; objekt: Row; reload: () => void; oeffne: (seite: string, id?: number) => void }) {
  const e = props.einheit;
  const [a, setA] = useState<Row>(() => ({ titel: e.angebot?.titel ?? `${e.zimmer ? zahl(e.zimmer) + '-Zimmer-' : ''}${e.art} – ${e.bezeichnung}`,
    kaltmiete: cent2(e.angebot?.kaltmiete_ct), bk: cent2(e.angebot?.bk_vz_ct), hk: cent2(e.angebot?.hk_vz_ct), kaution: cent2(e.angebot?.kaution_ct),
    frei_ab: e.angebot?.frei_ab ?? (e.letztes_ende && e.letztes_ende >= heute() ? new Date(Date.parse(e.letztes_ende) + 864e5).toISOString().slice(0, 10) : heute()),
    beschreibung: e.angebot?.beschreibung ?? '', ausstattung: e.angebot?.ausstattung ?? '', energie: e.angebot?.energie ?? '' }));
  const [liste, reload] = useLoad<Row[]>(() => call('interessentenListe', e.id), [e.id]);
  const [fotos] = useLoad<Row[]>(() => call('galerie', { einheit_id: e.id, nur_bilder: true }), [e.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [zusage, setZusage] = useState<Row | null>(null);
  const [ziel, setZiel] = useState<string | null>(null);

  const angebot = () => ({ kaltmiete_ct: parseCent(a.kaltmiete), bk_vz_ct: parseCent(a.bk), hk_vz_ct: parseCent(a.hk), kaution_ct: parseCent(a.kaution),
    frei_ab: a.frei_ab, titel: a.titel, beschreibung: a.beschreibung, ausstattung: a.ausstattung, energie: a.energie });
  const speichern = () => call('angebotSpeichern', e.id, angebot());

  async function expose() {
    await speichern();
    const o = props.objekt;
    const x = angebot();
    const bilder = (fotos ?? []).slice(0, 6).map((f) => `<img src="${dokUrl(f.datei)}" style="width:49%;height:62mm;object-fit:cover;margin:0 1% 2mm 0;border-radius:2mm">`).join('');
    await alsPdf([bericht(a.titel, `${o.bezeichnung} · ${[o.strasse, o.plz, o.ort].filter(Boolean).join(' ')}`,
      `${bilder}${tabelle(['', '#r'], [
        ['Wohnfläche', `#r${e.wohnflaeche ? zahl(e.wohnflaeche) + ' m²' : '–'}`], ['Zimmer', `#r${e.zimmer ? zahl(e.zimmer) : '–'}`], ['Lage im Haus', `#r${esc(e.lage ?? '–')}`],
        ['Kaltmiete', `#r${euro(x.kaltmiete_ct)}`], ['Betriebskosten-Vorauszahlung', `#r${euro(x.bk_vz_ct)}`], ['Heizkosten-Vorauszahlung', `#r${euro(x.hk_vz_ct)}`],
        ['<b>Gesamtmiete</b>', `#r<b>${euro(x.kaltmiete_ct + x.bk_vz_ct + x.hk_vz_ct)}</b>`], ['Kaution', `#r${euro(x.kaution_ct)}`], ['Frei ab', `#r${datum(x.frei_ab)}`],
        ...(a.energie ? [['Energieausweis', `#r${esc(a.energie)}`]] : []),
      ])}${a.beschreibung ? `<h2>Beschreibung</h2><p>${esc(a.beschreibung).replace(/\n/g, '<br>')}</p>` : ''}
      ${a.ausstattung ? `<h2>Ausstattung</h2><p>${esc(a.ausstattung).replace(/\n/g, '<br>')}</p>` : ''}`)], `Exposé ${e.bezeichnung}`);
  }

  async function selbstauskunft() {
    const einst = await call('einstellungen');
    const abs = absenderAus(einst);
    const feld = (l: string) => `<tr><td style="width:45%">${l}</td><td style="border-bottom:0.4pt solid #999">&nbsp;</td></tr>`;
    await alsPdf([bericht('Mieterselbstauskunft', `${props.objekt.bezeichnung}, ${e.bezeichnung} · Rückgabe an ${abs.name}`,
      `<p class="klein">Die Angaben sind freiwillig und dienen ausschließlich der Entscheidung über den Abschluss des Mietvertrags. Sie werden vertraulich behandelt und bei Nichtzustandekommen des Vertrags gelöscht (Art. 6 Abs. 1 lit. b DSGVO).</p>
       <table class="t">${['Name, Vorname', 'Geburtsdatum', 'Derzeitige Anschrift', 'Telefon / E-Mail', 'Beruf / Arbeitgeber', 'Beschäftigt seit', 'Monatliches Nettoeinkommen des Haushalts',
        'Anzahl einziehender Personen (davon Kinder)', 'Haustiere', 'Gewünschter Einzugstermin', 'Derzeitiger Vermieter (Name, Telefon)'].map(feld).join('')}</table>
       <p>Gegen mich läuft kein Insolvenzverfahren, und ich habe in den letzten fünf Jahren keine Vermögensauskunft abgegeben: ☐ zutreffend</p>
       <p>Mietrückstände aus dem jetzigen Mietverhältnis bestehen nicht: ☐ zutreffend</p>
       <p>Beigefügt: ☐ Einkommensnachweise der letzten 3 Monate ☐ Mietschuldenfreiheitsbescheinigung ☐ Bonitätsauskunft</p>
       <p style="margin-top:14mm">______________________ &nbsp; ______________________________<br><span class="klein">Ort, Datum &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Unterschrift</span></p>`)], `Selbstauskunft ${e.bezeichnung}`);
  }

  const verschieben = async (id: number, status: string) => { await call('save', 'interessenten', { id, status }); reload(); };
  const felder: Field[] = [
    { key: 'name', label: 'Name', required: true }, { key: 'telefon', label: 'Telefon' }, { key: 'email', label: 'E-Mail', wide: true },
    { key: 'besichtigung', label: 'Besichtigung am', type: 'date' }, { key: 'einzug_wunsch', label: 'Einzug ab', type: 'date' },
    { key: 'personen', label: 'Personen', type: 'number' }, { key: 'einkommen_ct', label: 'Haushaltsnetto / Monat', type: 'money' },
    { key: 'beruf', label: 'Beruf' }, { key: 'haustiere', label: 'Haustiere' },
    { key: 'selbstauskunft', label: 'Selbstauskunft liegt vor', type: 'check' }, { key: 'bonitaet', label: 'Bonität / Gehaltsnachweise geprüft', type: 'check' },
    { key: 'bewertung', label: 'Eindruck (1–5)', type: 'select', options: [[5, '★★★★★'], [4, '★★★★'], [3, '★★★'], [2, '★★'], [1, '★']] },
    { key: 'quelle', label: 'Gefunden über', type: 'select', options: ['ImmoScout24', 'Kleinanzeigen', 'Empfehlung', 'Aushang', 'Website', 'Sonstiges'].map((x) => [x, x]) },
    { key: 'notiz', label: 'Notiz', type: 'textarea' },
  ];
  const warm = parseCent(a.kaltmiete) + parseCent(a.bk) + parseCent(a.hk);

  return (
    <>
      <div className="zweispaltig" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="panel">
          <h3>Angebot</h3>
          <div className="maske zwei">
            <label className="breit">Titel<input value={a.titel} onChange={(ev) => setA({ ...a, titel: ev.target.value })} /></label>
            <label>Kaltmiete (€)<input className="num" value={a.kaltmiete} onChange={(ev) => setA({ ...a, kaltmiete: ev.target.value })} /></label>
            <label>Frei ab<input type="date" value={a.frei_ab} onChange={(ev) => setA({ ...a, frei_ab: ev.target.value })} /></label>
            <label>BK-Vorauszahlung (€)<input className="num" value={a.bk} onChange={(ev) => setA({ ...a, bk: ev.target.value })} /></label>
            <label>HK-Vorauszahlung (€)<input className="num" value={a.hk} onChange={(ev) => setA({ ...a, hk: ev.target.value })} /></label>
            <label>Kaution (€)<input className="num" value={a.kaution} placeholder={a.kaltmiete ? `max. ${cent2(parseCent(a.kaltmiete) * 3)}` : ''} onChange={(ev) => setA({ ...a, kaution: ev.target.value })} /></label>
            <label>Energieausweis<input value={a.energie} placeholder="z. B. Verbrauch 112 kWh/(m²a), Gas, Kl. D" onChange={(ev) => setA({ ...a, energie: ev.target.value })} /></label>
            <label className="breit">Beschreibung<textarea rows={3} value={a.beschreibung} onChange={(ev) => setA({ ...a, beschreibung: ev.target.value })} /></label>
            <label className="breit">Ausstattung<textarea rows={2} value={a.ausstattung} onChange={(ev) => setA({ ...a, ausstattung: ev.target.value })} /></label>
          </div>
          <p className="klein hinweis">
            Gesamtmiete {euro(warm)}{e.wohnflaeche ? ` · ${euro(Math.round(parseCent(a.kaltmiete) / e.wohnflaeche))} kalt je m²` : ''}.
            {parseCent(a.kaution) > parseCent(a.kaltmiete) * 3 ? ' Achtung: Die Kaution darf höchstens drei Kaltmieten betragen (§ 551 BGB).' : ''}
          </p>
          <div className="buttons">
            <button onClick={() => speichern().then(props.reload)}>Speichern</button>
            <span className="spacer" />
            <button className="icon" onClick={selbstauskunft}><I.FileText size={15} />Selbstauskunft</button>
            <button className="icon primary" onClick={expose}><I.Images size={15} />Exposé (PDF)</button>
          </div>
        </div>
        <div className="panel">
          <h3>Fotos der Einheit ({fotos?.length ?? 0})</h3>
          {fotos?.length ? <div className="galerie">{fotos.slice(0, 6).map((f) => <div key={f.id} className="kachelbild"><div className="bild" style={{ backgroundImage: `url("${dokUrl(f.datei)}")`, height: 90 }} /></div>)}</div>
            : <p className="hinweis">Fotos fürs Exposé unter Einheiten → „Fotos & Dokumente“ hinzufügen.</p>}
        </div>
      </div>
      <div className="toolbar"><h3>Interessenten</h3><span className="spacer" />
        <button className="primary" onClick={() => setEdit({ einheit_id: e.id, status: 'neu' })}>Interessent hinzufügen</button></div>
      <div className="kanban">
        {SPALTEN.map(([k, l]) => {
          const karten = (liste ?? []).filter((x) => x.status === k);
          return (
            <div key={k} className={`spalte${ziel === k ? ' ziel' : ''}`}
              onDragOver={(ev) => { ev.preventDefault(); ev.stopPropagation(); setZiel(k); window.dispatchEvent(new Event('hv-ziehen-aus')); }}
              onDragLeave={() => setZiel(null)}
              onDrop={(ev) => { ev.preventDefault(); ev.stopPropagation(); setZiel(null); const id = Number(ev.dataTransfer.getData('text/interessent')); if (id) verschieben(id, k); }}>
              <h4>{l}<span>{karten.length}</span></h4>
              {karten.map((x) => (
                <div key={x.id} className="karte" draggable onDragStart={(ev) => ev.dataTransfer.setData('text/interessent', String(x.id))} onDoubleClick={() => setEdit(x)}>
                  <b>{x.name}</b>
                  <div className="klein">{[x.personen ? `${x.personen} Pers.` : null, x.einkommen_ct ? `${euro(x.einkommen_ct)} netto` : null, x.beruf].filter(Boolean).join(' · ')}</div>
                  <div className="klein hinweis">{x.bewertung ? '★'.repeat(x.bewertung) + ' ' : ''}{x.besichtigung ? `Besichtigung ${datum(x.besichtigung)}` : ''}
                    {x.einkommen_ct && warm ? ` · Miete ${Math.round((warm / x.einkommen_ct) * 100)} % vom Netto` : ''}</div>
                  <div className="buttons" style={{ marginTop: 6 }}>
                    <button className="icon" title="Bearbeiten" onClick={() => setEdit(x)}><I.Pencil size={14} /></button>
                    {x.email && <button className="icon" title="E-Mail" onClick={() => window.hv.extern(`mailto:${x.email}?subject=${encodeURIComponent(a.titel)}`)}><I.Mail size={14} /></button>}
                    <button className="icon" title="Besichtigungstermin" onClick={async () => {
                      await call('save', 'termine', { titel: `Besichtigung ${e.bezeichnung}: ${x.name}`, datum: x.besichtigung ?? heute(), uhrzeit: '17:00', objekt_id: props.objekt.id });
                      await verschieben(x.id, 'besichtigung');
                    }}><I.CalendarPlus size={14} /></button>
                    {k !== 'absage' && <button className="icon primary" title="Zusage: Mieter und Mietvertrag anlegen" onClick={() => setZusage({ ...x, beginn: x.einzug_wunsch ?? a.frei_ab })}><I.Check size={14} />Zusage</button>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {edit && <FormDialog title={edit.id ? 'Interessent bearbeiten' : 'Neuer Interessent'} row={edit} fields={felder}
        onSave={(r) => call('save', 'interessenten', { ...r, einheit_id: e.id })} onDelete={() => call('remove', 'interessenten', edit.id)} onClose={() => { setEdit(null); reload(); }} />}
      {zusage && (
        <Dialog titel={`Zusage an ${zusage.name}`} onClose={() => setZusage(null)} aktionen={
          <button className="primary" onClick={async () => {
            try {
              await speichern();
              const neu = await call('zusage', zusage.id, zusage.beginn);
              setZusage(null); reload(); props.reload();
              await sollNachfrage('miete', neu.vertrag_id, { fruehereMonate: true });
              if (confirm('Mieter und Mietverhältnis sind angelegt; die übrigen Interessenten stehen auf „Abgesagt“. Jetzt zur Einzugsübergabe?')) props.oeffne('uebergabe');
            } catch (err) { fehler(err); }
          }}>Mieter anlegen</button>}>
          <p>Es werden eine Person und ein Mietverhältnis für <b>{e.bezeichnung}</b> mit den Werten des Angebots angelegt (Kaltmiete {euro(parseCent(a.kaltmiete))}, Kaution {euro(parseCent(a.kaution))}).</p>
          <div className="maske zwei"><label>Mietbeginn<input type="date" value={zusage.beginn} onChange={(ev) => setZusage({ ...zusage, beginn: ev.target.value })} /></label></div>
          <p className="klein hinweis">Den Mietvertrag selbst bitte auf einem geprüften Formular (z. B. Haus & Grund) erstellen; die Daten stehen danach unter „Mieter“.</p>
        </Dialog>
      )}
    </>
  );
}
