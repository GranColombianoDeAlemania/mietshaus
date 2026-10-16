// DATEV export and CSV lists for spreadsheets.
import { useState } from 'react';
import { call, datum, diesesJahr, fehler, personName, type Row } from '../api';
import { useLoad } from '../useLoad';
import { Zeitraum } from '../ui';

// Semicolon CSV with UTF-8 BOM so Excel and Numbers open umlauts correctly.
const csv = (kopf: string[], zeilen: (string | number | null | undefined)[][]) =>
  '﻿' + [kopf, ...zeilen].map((z) => z.map((c) => {
    const s = c == null ? '' : typeof c === 'number' ? String(c).replace('.', ',') : String(c);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');

const cent = (ct: number | null | undefined) => (ct == null ? '' : ((ct ?? 0) / 100).toFixed(2).replace('.', ','));

export function Export(props: { objekt: Row }) {
  const [von, setVon] = useState(`${diesesJahr() - 1}-01-01`);
  const [bis, setBis] = useState(`${diesesJahr() - 1}-12-31`);
  const [einst] = useLoad<Row>(() => call('einstellungen'), []);
  const [meldung, setMeldung] = useState('');
  const o = props.objekt;
  const name = (s: string) => `${s} ${o.bezeichnung}`.replace(/[/\\:]/g, '-');
  const speichern = async (inhalt: string, datei: string) => {
    const p = await window.hv.speichern(inhalt, datei, { name: 'CSV', extensions: ['csv'] });
    if (p) setMeldung(`Gespeichert: ${p}`);
  };

  const exporte: [string, string, () => Promise<void>][] = [
    ['DATEV-Buchungsstapel', 'Alle Buchungen des Zeitraums im DATEV-Format (EXTF) für den Steuerberater.', async () => {
      if (!einst?.datev_berater || !einst?.datev_mandant) return alert('Bitte zuerst DATEV Berater- und Mandantennummer unter Einstellungen eintragen.');
      const inhalt = await call('datevExport', o.id, von, bis, einst.datev_berater, einst.datev_mandant, `${von.slice(0, 4)}-${o.wj_beginn ?? '01-01'}`);
      const p = await window.hv.speichern(inhalt, `EXTF_Buchungsstapel_${o.bezeichnung}_${von.slice(0, 4)}.csv`.replace(/\s+/g, '_'), { name: 'DATEV', extensions: ['csv'] });
      if (p) setMeldung(`Gespeichert: ${p}`);
    }],
    ['Journal', 'Alle Buchungen des Zeitraums als Tabelle.', async () => {
      const rows: Row[] = await call('buchungen', o.id, { von, bis });
      await speichern(csv(['Datum', 'Beleg', 'Text', 'Soll', 'Soll-Konto', 'Haben', 'Haben-Konto', 'Betrag'],
        rows.reverse().map((b) => [datum(b.datum), b.beleg, b.text, b.soll_nr, b.soll_bez, b.haben_nr, b.haben_bez, cent(b.betrag_ct)])), `${name('Journal')} ${von.slice(0, 4)}.csv`);
    }],
    ['Saldenliste', 'Anfangs- und Endsalden aller Konten.', async () => {
      const rows: Row[] = await call('saldenliste', o.id, von, bis);
      await speichern(csv(['Konto', 'Bezeichnung', 'Anfang', 'Soll', 'Haben', 'Ende'], rows.map((r) => [r.nr, r.bezeichnung, cent(r.anfang_ct), cent(r.soll_ct), cent(r.haben_ct), cent(r.ende_ct)])),
        `${name('Saldenliste')} ${von.slice(0, 4)}.csv`);
    }],
    ['Mieterliste', 'Alle Mietverhältnisse mit Beträgen und Kontaktdaten.', async () => {
      const rows: Row[] = await call('vertraege', 'mietverhaeltnisse', o.id);
      const personen: Row[] = await call('personen');
      await speichern(csv(['Einheit', 'Name', 'Beginn', 'Ende', 'Kaltmiete', 'BK-VZ', 'HK-VZ', 'Kaution', 'Personen', 'Telefon', 'E-Mail', 'IBAN'],
        rows.map((v) => { const p = personen.find((x) => x.id === v.person_id) ?? {}; return [v.einheit, v.name, datum(v.beginn), datum(v.ende), cent(v.kaltmiete_ct), cent(v.bk_vz_ct), cent(v.hk_vz_ct), cent(v.kaution_ct), v.personen_anzahl, p.telefon || p.mobil, p.email, p.iban]; })),
      `${name('Mieterliste')}.csv`);
    }],
    ['Eigentümerliste', 'Alle Eigentümer mit Hausgeld, MEA und Kontaktdaten.', async () => {
      const rows: Row[] = await call('vertraege', 'eigentum', o.id);
      const personen: Row[] = await call('personen');
      const einheiten: Row[] = await call('einheiten', o.id);
      await speichern(csv(['Einheit', 'MEA', 'Name', 'Beginn', 'Ende', 'Hausgeld', 'davon Rücklage', 'Selbstnutzer', 'Telefon', 'E-Mail', 'IBAN'],
        rows.map((v) => { const p = personen.find((x) => x.id === v.person_id) ?? {}; return [v.einheit, einheiten.find((e) => e.id === v.einheit_id)?.mea, v.name, datum(v.beginn), datum(v.ende), cent(v.hausgeld_ct), cent(v.ruecklage_ct), v.selbstnutzer ? 'ja' : 'nein', p.telefon || p.mobil, p.email, p.iban]; })),
      `${name('Eigentümerliste')}.csv`);
    }],
    ['Adressbuch', 'Alle Personen mit Anschrift und Kontaktdaten.', async () => {
      const rows: Row[] = await call('personen');
      await speichern(csv(['Name', 'Anrede', 'Vorname', 'Nachname', 'Firma', 'Straße', 'PLZ', 'Ort', 'Telefon', 'Mobil', 'E-Mail', 'IBAN'],
        rows.map((p) => [personName(p), p.anrede, p.vorname, p.nachname, p.firma, p.strasse, p.plz, p.ort, p.telefon, p.mobil, p.email, p.iban])), 'Adressbuch.csv');
    }],
    ['Offene Posten', 'Rückstände und Guthaben aller Mieter und Eigentümer.', async () => {
      const rows: Row[] = [...await call('offenePosten', o.id, bis, 'miete'), ...await call('offenePosten', o.id, bis, 'weg')];
      await speichern(csv(['Konto', 'Name', 'Saldo (+ Rückstand / − Guthaben)'], rows.map((r) => [r.konto.nr, r.konto.bezeichnung, cent(r.summe_ct)])), `${name('Offene Posten')}.csv`);
    }],
  ];

  return (
    <section>
      <div className="toolbar">
        <h1>Export &amp; Steuer</h1>
        <span className="spacer" />
        <Zeitraum von={von} bis={bis} onChange={(a, b) => { setVon(a); setBis(b); }} />
      </div>
      {meldung && <p className="meldung">{meldung}</p>}
      <table>
        <tbody>
          {exporte.map(([t, h, f]) => (
            <tr key={t}><td><b>{t}</b><div className="klein hinweis">{h}</div></td>
              <td className="aktionen"><button onClick={() => f().catch(fehler)}>Exportieren…</button></td></tr>
          ))}
        </tbody>
      </table>
      <p className="hinweis klein">
        DATEV: Kontonummern werden unverändert übergeben (Sachkontenlänge 5, Personenkonten 6-stellig). Stimme die Zuordnung zum
        Kontenrahmen deines Steuerberaters vorher mit ihm ab; der Import wurde nicht gegen eine DATEV-Installation getestet.
      </p>
    </section>
  );
}
