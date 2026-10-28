import { useState } from 'react';
import { betrag, call, datum, euro, fehler, fehlerText, heute, inTagen, personName, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { KontoSelect, Tabs } from '../ui';
import { ibanGueltig, leseKontoauszug, painLastschrift, type Umsatz } from '../bankformate';

type Zeile = Umsatz & { konto_id: number | '' | null; doppelt: boolean; an: boolean; lernen: boolean };

export function Bank(props: { objekt: Row; modus: Modus }) {
  const [tab, setTab] = useState<'import' | 'lastschrift' | 'regeln'>('import');
  return (
    <section>
      <div className="toolbar">
        <h1>Bank</h1>
        <Tabs tabs={[['import', 'Kontoauszug importieren'], ['lastschrift', 'SEPA-Lastschrift'], ['regeln', 'Gelernte Zuordnungen']]} value={tab} onChange={setTab} />
      </div>
      {tab === 'import' ? <Import objekt={props.objekt} /> : tab === 'lastschrift' ? <Lastschriften objekt={props.objekt} modus={props.modus} /> : <Regeln objekt={props.objekt} />}
    </section>
  );
}

// Learnable pattern: the payer/payee name, which stays the same across months unlike the purpose text.
const musterVon = (u: Umsatz) => (u.name || u.zweck).toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40);

function Import(props: { objekt: Row }) {
  const [konten, ladeKonten] = useLoad<Row[]>(() => call('konten', props.objekt.id), [props.objekt.id]);
  const geld = (konten ?? []).filter((k) => k.klasse === 'geld');
  const [geldId, setGeldId] = useState<number | ''>('');
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [datei, setDatei] = useState('');
  const [meldung, setMeldung] = useState('');
  const giro = geldId || geld[0]?.id || '';

  async function laden() {
    const f = await window.hv.oeffnen({ name: 'Kontoauszug (CAMT, MT940, CSV)', extensions: ['xml', 'sta', 'mt940', 'txt', 'csv', 'zip'] });
    if (!f) return;
    try {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      const umsaetze = leseKontoauszug(bytes);
      const v: Row[] = await call('bankVorschlaege', props.objekt.id, umsaetze);
      setZeilen(v.map((u) => ({ ...(u as Zeile), an: !u.doppelt && !!u.konto_id, lernen: true })));
      setDatei(f.name);
      setMeldung(`${umsaetze.length} Umsätze gelesen, ${v.filter((u) => u.doppelt).length} davon bereits gebucht.`);
    } catch (e) {
      fehler(e);
    }
  }

  async function buchen() {
    try {
      const auswahl = zeilen.filter((z) => z.an && z.konto_id && !z.doppelt).map((z) => ({ ...z, muster: z.lernen ? musterVon(z) : null }));
      const n = await call('bankBuchen', props.objekt.id, giro, auswahl, true);
      setMeldung(`${n} Umsätze gebucht.`);
      const v: Row[] = await call('bankVorschlaege', props.objekt.id, zeilen);
      setZeilen(v.map((u) => ({ ...(u as Zeile), an: false, lernen: true })));
      ladeKonten();
    } catch (e) {
      setMeldung(fehlerText(e));
    }
  }

  const set = (i: number, z: Partial<Zeile>) => setZeilen(zeilen.map((x, j) => (j === i ? { ...x, ...z } : x)));
  const anzahl = zeilen.filter((z) => z.an && z.konto_id && !z.doppelt).length;

  return (
    <>
      <p className="hinweis">
        Lade den Kontoauszug deiner Bank als Datei (CAMT.053-XML, MT940 oder CSV aus dem Online-Banking). Die Zuordnung zu
        Mietern und Eigentümern erfolgt über IBAN und Name; was du einmal zuordnest, merkt sich das Programm für die nächsten Auszüge.
      </p>
      <div className="toolbar">
        <label>Bankkonto <KontoSelect konten={geld} klassen={['geld']} value={giro} onChange={setGeldId} /></label>
        <button className="primary" onClick={laden}>Datei wählen…</button>
        {datei && <span className="hinweis">{datei}</span>}
        <span className="spacer" />
        {meldung && <span className="meldung">{meldung}</span>}
        <button className="primary" disabled={!anzahl || !giro} onClick={buchen}>{anzahl} Umsätze buchen</button>
      </div>
      {zeilen.length > 0 && konten && (
        <table>
          <thead><tr><th /><th>Datum</th><th>Name / Verwendungszweck</th><th className="num">Betrag</th><th>Gegenkonto</th><th title="Zuordnung für künftige Auszüge merken">merken</th></tr></thead>
          <tbody>
            {zeilen.map((z, i) => (
              <tr key={z.ref} className={z.doppelt ? 'inaktiv' : ''}>
                <td><input type="checkbox" disabled={z.doppelt} checked={z.an} onChange={(e) => set(i, { an: e.target.checked })} /></td>
                <td>{datum(z.datum)}</td>
                <td><b>{z.name}</b><div className="klein">{z.zweck}</div>{z.doppelt && <span className="tag">bereits gebucht</span>}
                  {(z as Row).hinweis && <div className={`klein ${(z as Row).ruecklast ? 'fehlertext' : 'meldung'}`}>{(z as Row).hinweis}</div>}</td>
                <td className="num"><span className={z.betrag_ct < 0 ? 'negativ' : ''}>{betrag(z.betrag_ct)}</span></td>
                <td>
                  <KontoSelect konten={konten} klassen={z.betrag_ct > 0 ? ['person', 'einnahme', 'geld', 'kosten', 'darlehen'] : ['kosten', 'darlehen', 'person', 'geld', 'ruecklage']}
                    value={z.konto_id ?? ''} onChange={(id) => set(i, { konto_id: id, an: !!id })} leer="– nicht buchen –" />
                </td>
                <td><input type="checkbox" checked={z.lernen} onChange={(e) => set(i, { lernen: e.target.checked })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Lastschriften(props: { objekt: Row; modus: Modus }) {
  const [stichtag, setStichtag] = useState(heute());
  const [faellig, setFaellig] = useState(() => inTagen(5));
  const [einst] = useLoad<Row>(() => call('einstellungen'), []);
  const [rows] = useLoad<Row[]>(() => call('lastschriften', props.objekt.id, stichtag, [props.modus]), [props.objekt.id, stichtag, props.modus]);
  const [aus, setAus] = useState<Record<number, boolean>>({});

  const probleme = (r: Row) => [
    !r.vertrag.iban ? 'IBAN fehlt' : !ibanGueltig(r.vertrag.iban) ? 'IBAN ungültig' : '',
    !r.vertrag.sepa_mandat ? 'Mandatsreferenz fehlt' : '',
  ].filter(Boolean);
  const ok = (rows ?? []).filter((r) => !aus[r.konto_id] && !probleme(r).length);
  const objektFehlt = [!props.objekt.iban && 'IBAN des Objektkontos', !props.objekt.sepa_glaeubiger_id && 'Gläubiger-ID'].filter(Boolean);

  async function erzeugen() {
    const xml = painLastschrift({
      glaeubiger: einst?.verwalter_name || props.objekt.bezeichnung,
      glaeubigerId: props.objekt.sepa_glaeubiger_id,
      iban: props.objekt.iban,
      bic: props.objekt.bic,
      faellig,
      posten: ok.map((r) => ({
        name: r.vertrag.kontoinhaber || personName(r.vertrag),
        iban: r.vertrag.iban,
        bic: r.vertrag.bic,
        betrag_ct: r.betrag_ct,
        mandat: r.vertrag.sepa_mandat,
        mandatDatum: r.vertrag.beginn,
        zweck: `${r.typ === 'weg' ? 'Hausgeld' : 'Miete'} ${props.objekt.bezeichnung} ${r.vertrag.einheit} bis ${datum(stichtag)}`,
        e2e: `HV-${r.konto_id}-${faellig.replace(/-/g, '')}`,
      })),
    });
    await window.hv.speichern(xml, `Lastschrift ${props.objekt.bezeichnung} ${faellig}.xml`, { name: 'SEPA-XML', extensions: ['xml'] });
  }

  return (
    <>
      <p className="hinweis">
        Erstellt eine SEPA-Lastschriftdatei (pain.008) über die offenen Beträge aller Verträge mit Lastschrift. Die Datei lädst du
        im Online-Banking hoch. Die Zahlungen buchst du später wie gewohnt über den Kontoauszug-Import.
      </p>
      {objektFehlt.length > 0 && <p className="fehler">Im Objekt fehlt noch: {objektFehlt.join(', ')}.</p>}
      <div className="toolbar">
        <label>Offene Posten bis <input type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value)} /></label>
        <label>Fälligkeit (Einzug am) <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} /></label>
        <span className="spacer" />
        <b>{euro(ok.reduce((s, r) => s + r.betrag_ct, 0))}</b>
        <button className="primary" disabled={!ok.length || objektFehlt.length > 0} onClick={erzeugen}>SEPA-Datei erstellen ({ok.length})</button>
      </div>
      <table>
        <thead><tr><th /><th>Name</th><th>Einheit</th><th>IBAN</th><th>Mandat</th><th className="num">Betrag</th><th>Hinweis</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.konto_id} className={probleme(r).length ? 'inaktiv' : ''}>
              <td><input type="checkbox" disabled={!!probleme(r).length} checked={!aus[r.konto_id] && !probleme(r).length} onChange={(e) => setAus({ ...aus, [r.konto_id]: !e.target.checked })} /></td>
              <td>{personName(r.vertrag)}</td><td>{r.vertrag.einheit}</td><td>{r.vertrag.iban}</td><td>{r.vertrag.sepa_mandat}</td>
              <td className="num">{euro(r.betrag_ct)}</td>
              <td className="fehlertext">{probleme(r).join(', ')}</td>
            </tr>
          ))}
          {!rows?.length && <tr><td colSpan={7} className="hinweis">Keine offenen Beträge bei Verträgen mit Lastschrift.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Regeln(props: { objekt: Row }) {
  const [rows, reload] = useLoad<Row[]>(() => call('bankregeln', props.objekt.id), [props.objekt.id]);
  return (
    <table>
      <thead><tr><th>Wenn Name/Zweck enthält</th><th>dann Gegenkonto</th><th /></tr></thead>
      <tbody>
        {rows?.map((r) => (
          <tr key={r.id}>
            <td>{r.muster}</td><td>{r.nr} {r.bezeichnung}</td>
            <td className="aktionen"><button onClick={async () => { await call('remove', 'bankregeln', r.id); reload(); }}>Löschen</button></td>
          </tr>
        ))}
        {!rows?.length && <tr><td colSpan={3} className="hinweis">Noch keine gelernten Zuordnungen.</td></tr>}
      </tbody>
    </table>
  );
}
