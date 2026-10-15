import { useState } from 'react';
import { betrag, call, datum, diesesJahr, KLASSEN, kontoLabel, type Modus, type Row } from '../api';
import { FormDialog, type Field } from '../Form';
import { useLoad } from '../useLoad';
import { Dialog, Saldo, Tabs, Zeitraum } from '../ui';
import { alsPdf, bericht, esc, tabelle } from '../dokument';

const shText = (ct: number) => (ct === 0 ? '0,00' : `${betrag(Math.abs(ct))} ${ct > 0 ? 'S' : 'H'}`);

const KATEGORIEN_KOSTEN: [string, string][] = [
  ['bk01', 'BetrKV Nr. 1 – Grundsteuer'], ['bk02', 'Nr. 2 – Wasserversorgung'], ['bk03', 'Nr. 3 – Entwässerung'],
  ['bk04', 'Nr. 4 – Heizung'], ['bk05', 'Nr. 5 – Warmwasser'], ['bk07', 'Nr. 7 – Aufzug'],
  ['bk08', 'Nr. 8 – Straßenreinigung / Müll'], ['bk09', 'Nr. 9 – Gebäudereinigung'], ['bk10', 'Nr. 10 – Gartenpflege'],
  ['bk11', 'Nr. 11 – Beleuchtung'], ['bk12', 'Nr. 12 – Schornsteinreinigung'], ['bk13', 'Nr. 13 – Versicherungen'],
  ['bk14', 'Nr. 14 – Hauswart'], ['bk15', 'Nr. 15 – Antenne / Kabel'], ['bk16', 'Nr. 16 – Wäschepflege'],
  ['bk17', 'Nr. 17 – Sonstige Betriebskosten'], ['verwaltung', 'Verwaltung'], ['instandhaltung', 'Instandhaltung'],
  ['bank', 'Bankgebühren'], ['sonstige', 'Sonstige Kosten'],
];
const KATEGORIEN_EINNAHME: [string, string][] = [
  ['miete', 'Kaltmiete'], ['sonst', 'Sonstige Miete'], ['bk', 'BK-Vorauszahlung'], ['hk', 'HK-Vorauszahlung'],
  ['kaution', 'Kaution'], ['nk_ergebnis', 'Ergebnis NK-Abrechnung'], ['hausgeld', 'Hausgeld'], ['ruecklage', 'Rücklagenzuführung'],
  ['sonderumlage', 'Sonderumlage'], ['weg_ergebnis', 'Ergebnis Hausgeldabrechnung'], ['mahngebuehr', 'Mahngebühren'], ['zins', 'Zinsen'],
  ['sonstige', 'Sonstige Einnahmen'],
];

export function Konten(props: { objekt: Row; modus: Modus }) {
  const [tab, setTab] = useState<'plan' | 'salden'>('plan');
  const [konten, reload] = useLoad<Row[]>(() => call('konten', props.objekt.id), [props.objekt.id]);
  const [keys] = useLoad<Row[]>(() => call('schluessel', props.objekt.id), [props.objekt.id]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [auszug, setAuszug] = useState<Row | null>(null);
  const [nurBebucht, setNurBebucht] = useState(false);
  const [von, setVon] = useState(`${diesesJahr()}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr()}-12-31`);

  const keyOpts: [number, string][] = (keys ?? []).map((k) => [k.id, k.bezeichnung]);
  const felder = (k: Row): Field[] => [
    { key: 'nr', label: 'Kontonummer', type: 'number', required: true },
    { key: 'bezeichnung', label: 'Bezeichnung', required: true },
    { key: 'klasse', label: 'Kontoart', type: 'select', required: true, options: Object.entries(KLASSEN).filter(([c]) => c !== 'person') },
    ...(k.klasse === 'kosten' ? [
      { key: 'kategorie', label: 'Kostenart', type: 'select', options: KATEGORIEN_KOSTEN, section: 'Verteilung' } as Field,
      { key: 'umlagefaehig', label: 'Auf Mieter umlegbar (Betriebskosten)', type: 'check' } as Field,
      { key: 'heizkosten', label: 'Gehört zur Heizkostenabrechnung', type: 'check' } as Field,
      { key: 'schluessel_id', label: 'Schlüssel Nebenkostenabrechnung (Mieter)', type: 'select', options: keyOpts } as Field,
      { key: 'weg_schluessel_id', label: 'Schlüssel Hausgeldabrechnung (WEG)', type: 'select', options: keyOpts } as Field,
      { key: 'aus_ruecklage', label: 'Wird aus der Erhaltungsrücklage bezahlt', type: 'check' } as Field,
      { key: 'p35a', label: '§ 35a EStG', type: 'select', options: [['dienstleistung', 'Haushaltsnahe Dienstleistung'], ['handwerker', 'Handwerkerleistung']] } as Field,
    ] : []),
    ...(k.klasse === 'einnahme' ? [{ key: 'kategorie', label: 'Einnahmeart', type: 'select', options: KATEGORIEN_EINNAHME } as Field] : []),
    ...(k.klasse === 'geld' ? [{ key: 'iban', label: 'IBAN' } as Field] : []),
    { key: 'inaktiv', label: 'Inaktiv (nicht mehr zur Auswahl anbieten)', type: 'check' },
  ];

  return (
    <section>
      <div className="toolbar">
        <h1>Konten – {props.objekt.bezeichnung}</h1>
        <Tabs tabs={[['plan', 'Kontenplan'], ['salden', 'Saldenliste']]} value={tab} onChange={setTab} />
        <span className="spacer" />
        {tab === 'plan' ? (
          <>
            <label className="check"><input type="checkbox" checked={nurBebucht} onChange={(e) => setNurBebucht(e.target.checked)} /> nur bebuchte</label>
            <button onClick={() => setEdit({ klasse: 'kosten', objekt_id: props.objekt.id })}>Neues Konto</button>
          </>
        ) : (
          <Zeitraum von={von} bis={bis} onChange={(a, b) => { setVon(a); setBis(b); }} />
        )}
      </div>
      {tab === 'plan' ? (
        Object.entries(KLASSEN).map(([klasse, titel]) => {
          // Contract accounts of the other mode stay hidden; all other accounts are shared by the object.
          const ks = (konten ?? []).filter((k) => k.klasse === klasse && (!nurBebucht || k.anzahl) && (k.klasse !== 'person' || k.vertrag_typ === props.modus));
          if (!ks.length) return null;
          return (
            <div key={klasse} className="block">
              <h3>{titel}</h3>
              <table>
                <thead><tr><th className="num">Nr.</th><th>Bezeichnung</th><th>Merkmale</th><th className="num">Buchungen</th><th className="num">Saldo</th><th /></tr></thead>
                <tbody>
                  {ks.map((k) => (
                    <tr key={k.id} className={k.inaktiv ? 'inaktiv' : ''} onDoubleClick={() => setAuszug(k)}>
                      <td className="num">{k.nr}</td>
                      <td>{k.bezeichnung}</td>
                      <td className="klein">
                        {k.umlagefaehig ? <span className="tag art-miete">umlagefähig</span> : null}
                        {k.heizkosten ? <span className="tag">Heizkosten</span> : null}
                        {k.aus_ruecklage ? <span className="tag art-weg">aus Rücklage</span> : null}
                        {k.p35a ? <span className="tag">§ 35a</span> : null}
                      </td>
                      <td className="num">{k.anzahl}</td>
                      <td className="num"><Saldo ct={k.saldo_ct} /></td>
                      <td className="aktionen">
                        <button onClick={() => setAuszug(k)}>Kontoauszug</button>
                        {k.klasse !== 'person' && <button onClick={() => setEdit(k)}>Bearbeiten</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      ) : (
        <Saldenliste objekt={props.objekt} von={von} bis={bis} />
      )}
      {edit && (
        <FormDialog
          title={edit.id ? 'Konto bearbeiten' : 'Neues Konto'}
          fields={felder}
          row={edit}
          onSave={(r) => call('save', 'konten', { ...r, objekt_id: props.objekt.id })}
          onDelete={() => call('kontoLoeschen', edit.id)}
          onClose={() => { setEdit(null); reload(); }}
        />
      )}
      {auszug && <Kontoauszug konto={auszug} objekt={props.objekt} onClose={() => setAuszug(null)} />}
    </section>
  );
}

function Saldenliste(props: { objekt: Row; von: string; bis: string }) {
  const [rows] = useLoad<Row[]>(() => call('saldenliste', props.objekt.id, props.von, props.bis), [props.objekt.id, props.von, props.bis]);
  const summe = (k: string) => (rows ?? []).reduce((s, r) => s + r[k], 0);

  function drucken() {
    const z = (rows ?? []).map((r) => [r.nr, esc(r.bezeichnung), `#r${betrag(r.anfang_ct)}`, `#r${betrag(r.soll_ct)}`, `#r${betrag(r.haben_ct)}`, `#r${shText(r.ende_ct)}`]);
    alsPdf([bericht(`Saldenliste ${props.objekt.bezeichnung}`, `Zeitraum ${datum(props.von)} – ${datum(props.bis)}`,
      tabelle(['Konto', 'Bezeichnung', '#rAnfang', '#rSoll', '#rHaben', '#rEnde'], z,
        { summe: ['', 'Summe', `#r${betrag(summe('anfang_ct'))}`, `#r${betrag(summe('soll_ct'))}`, `#r${betrag(summe('haben_ct'))}`, `#r${betrag(summe('ende_ct'))}`] }))],
    `Saldenliste ${props.objekt.bezeichnung} ${props.von.slice(0, 4)}`);
  }

  return (
    <>
      <table>
        <thead><tr><th className="num">Nr.</th><th>Konto</th><th className="num">Anfangssaldo</th><th className="num">Soll</th><th className="num">Haben</th><th className="num">Endsaldo</th></tr></thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id}>
              <td className="num">{r.nr}</td><td>{r.bezeichnung}</td>
              <td className="num">{betrag(r.anfang_ct)}</td><td className="num">{betrag(r.soll_ct)}</td>
              <td className="num">{betrag(r.haben_ct)}</td><td className="num"><Saldo ct={r.ende_ct} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td /><td>Summe (muss bei Soll und Haben gleich sein)</td>
            <td className="num">{betrag(summe('anfang_ct'))}</td><td className="num"><b>{betrag(summe('soll_ct'))}</b></td>
            <td className="num"><b>{betrag(summe('haben_ct'))}</b></td><td className="num">{betrag(summe('ende_ct'))}</td>
          </tr>
        </tfoot>
      </table>
      <div className="buttons"><button onClick={drucken}>Als PDF</button></div>
    </>
  );
}

export function Kontoauszug(props: { konto: Row; objekt: Row; onClose: () => void }) {
  const [von, setVon] = useState(`${diesesJahr()}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr()}-12-31`);
  const [a] = useLoad<Row>(() => call('kontoauszug', props.konto.id, von, bis), [props.konto.id, von, bis]);

  function drucken() {
    if (!a) return;
    const z = a.zeilen.map((r: Row) => [datum(r.datum), esc(r.beleg ?? ''), esc(r.text ?? ''), esc(r.gegen),
      `#r${r.soll_ct ? betrag(r.soll_ct) : ''}`, `#r${r.haben_ct ? betrag(r.haben_ct) : ''}`, `#r${shText(r.saldo_ct)}`]);
    alsPdf([bericht(`Kontoauszug ${kontoLabel(props.konto)}`, `${props.objekt.bezeichnung} · ${datum(von)} – ${datum(bis)}`,
      `<p>Anfangssaldo: <b>${shText(a.anfang_ct)}</b></p>` +
      tabelle(['Datum', 'Beleg', 'Text', 'Gegenkonto', '#rSoll', '#rHaben', '#rSaldo'], z) +
      `<p class="hervor">Endsaldo: ${shText(a.ende_ct)}</p>`)], `Kontoauszug ${props.konto.nr}`);
  }

  return (
    <Dialog titel={`Kontoauszug ${kontoLabel(props.konto)}`} onClose={props.onClose} breit aktionen={<button onClick={drucken}>Als PDF</button>}>
      <div className="toolbar"><Zeitraum von={von} bis={bis} onChange={(x, y) => { setVon(x); setBis(y); }} /></div>
      {a && (
        <table>
          <thead><tr><th>Datum</th><th>Beleg</th><th>Text</th><th>Gegenkonto</th><th className="num">Soll</th><th className="num">Haben</th><th className="num">Saldo</th></tr></thead>
          <tbody>
            <tr className="zwischen"><td colSpan={6}>Anfangssaldo</td><td className="num"><Saldo ct={a.anfang_ct} /></td></tr>
            {a.zeilen.map((r: Row) => (
              <tr key={r.id}>
                <td>{datum(r.datum)}</td><td>{r.beleg}</td><td>{r.text}</td><td className="klein">{r.gegen}</td>
                <td className="num">{r.soll_ct ? betrag(r.soll_ct) : ''}</td>
                <td className="num">{r.haben_ct ? betrag(r.haben_ct) : ''}</td>
                <td className="num"><Saldo ct={r.saldo_ct} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={6}>Endsaldo</td><td className="num"><Saldo ct={a.ende_ct} fett /></td></tr></tfoot>
        </table>
      )}
    </Dialog>
  );
}
