import { useState } from 'react';
import { call, fehler, type Row } from '../api';
import { useLoad } from '../useLoad';

const FELDER: [string, string][] = [
  ['verwalter_name', 'Name / Firma'],
  ['verwalter_strasse', 'Straße'],
  ['verwalter_plz', 'PLZ'],
  ['verwalter_ort', 'Ort'],
  ['verwalter_telefon', 'Telefon'],
  ['verwalter_email', 'E-Mail'],
  ['verwalter_bank', 'Bank'],
  ['verwalter_iban', 'IBAN'],
  ['verwalter_bic', 'BIC'],
  ['verwalter_steuernr', 'Steuernummer'],
  ['datev_berater', 'DATEV Beraternummer'],
  ['datev_mandant', 'DATEV Mandantennummer'],
];

export function Einstellungen() {
  const [e, reload] = useLoad<Row>(() => call('einstellungen'), []);
  const [info] = useLoad(() => window.hv.info(), []);
  const [werte, setWerte] = useState<Row>({});
  const [meldung, setMeldung] = useState('');
  const wert = (k: string) => werte[k] ?? e?.[k] ?? '';

  return (
    <section>
      <div className="toolbar"><h1>Einstellungen & Datensicherung</h1></div>
      <div className="block">
        <h3>Verwalter (Absender auf Briefen und Abrechnungen)</h3>
        <div className="maske">
          {FELDER.map(([k, l]) => (
            <label key={k}>{l}<input value={wert(k)} onChange={(ev) => setWerte({ ...werte, [k]: ev.target.value })} /></label>
          ))}
        </div>
        <div className="buttons">
          <button className="primary" disabled={!Object.keys(werte).length} onClick={async () => {
            await call('setzeEinstellungen', werte);
            setWerte({});
            reload();
            setMeldung('Gespeichert.');
          }}>Speichern</button>
          {meldung && <span className="meldung">{meldung}</span>}
        </div>
      </div>
      <ClaudeVerbindung />
      <div className="block">
        <h3>Datensicherung</h3>
        <p className="hinweis">
          Alle Daten liegen in einer einzigen Datei. Sichere sie regelmäßig, z. B. auf einen USB-Stick oder in die iCloud.
          Abgelegte Dokumente liegen zusätzlich im Ordner „dokumente“ daneben.
        </p>
        <div className="buttons">
          <button className="primary" onClick={async () => {
            try {
              const p = await window.hv.sicherung();
              if (p) setMeldung(`Sicherung gespeichert: ${p}`);
            } catch (err) { fehler(err); }
          }}>Sicherung erstellen…</button>
          <button onClick={async () => {
            if (!confirm('Den aktuellen Datenbestand durch eine Sicherung ersetzen? Der jetzige Stand wird vorher automatisch daneben abgelegt.')) return;
            try {
              if (await window.hv.wiederherstellen()) location.reload();
            } catch (err) { fehler(err); }
          }}>Sicherung wiederherstellen…</button>
        </div>
        {info && (
          <p className="klein hinweis">
            Datenbank: {info.dbFile}<br />Dokumente: {info.dokumente}<br />Version {info.version}
          </p>
        )}
      </div>
    </section>
  );
}

function ClaudeVerbindung() {
  const [st, reload] = useLoad(() => window.hv.claudeStatus(), []);
  const [meldung, setMeldung] = useState('');
  return (
    <div className="block">
      <h3>Claude Desktop</h3>
      <p className="hinweis">
        Verbindet Hausverwalter mit der Claude-Desktop-App (dein Claude-Abo genügt, kein API-Schlüssel nötig). Danach kannst du in
        Claude z. B. sagen: „Arbeite das Postfach im Hausverwalter ab“ – Claude liest die Dokumente, legt sie ab und überträgt Rechnungen,
        Verträge, Zählerstände und Termine ins Programm. Jede Änderung bestätigst du in Claude.
      </p>
      {st && (
        <p>{st.verbunden ? <b className="meldung">✓ Verbunden.</b> : st.installiert ? 'Noch nicht verbunden.' : 'Claude Desktop scheint nicht installiert zu sein (claude.ai/download).'}</p>
      )}
      <div className="buttons">
        <button className="primary" onClick={async () => {
          try {
            await window.hv.claudeVerbinden();
            setMeldung('Eingetragen. Bitte Claude Desktop einmal ganz beenden (⌘Q) und neu starten.');
            reload();
          } catch (e) { fehler(e); }
        }}>{st?.verbunden ? 'Verbindung erneuern' : 'Mit Claude Desktop verbinden'}</button>
        {meldung && <span className="meldung">{meldung}</span>}
      </div>
      {st && <p className="klein hinweis">Konfiguration: {st.datei}</p>}
    </div>
  );
}
