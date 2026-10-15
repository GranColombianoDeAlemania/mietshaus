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
      <Dokumenteneingang />
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

function Dokumenteneingang() {
  const [e, reload] = useLoad<Row>(() => call('einstellungen'), []);
  const [f, setF] = useState<Row | null>(null);
  const [pw, setPw] = useState('');
  const [meldung, setMeldung] = useState('');
  const w = (k: string) => f?.[k] ?? e?.[k] ?? '';
  const set = (k: string, v: string) => setF({ ...(f ?? {}), [k]: v });
  const lauf = async (fn: () => Promise<unknown>) => {
    setMeldung('…');
    try { const r = await fn(); setMeldung(typeof r === 'string' ? r : JSON.stringify(r)); } catch (err) { setMeldung(`Fehler: ${String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`); }
    reload();
  };
  return (
    <div className="block">
      <h3>Dokumenteneingang</h3>
      <p className="hinweis">Alles, was hier ankommt, landet automatisch im Postfach und wird gelesen.</p>
      <div className="panel">
        <b>Eingangsordner</b>
        <p className="klein hinweis">Z. B. der Scan-Ordner deines Scanners, ein Ordner auf der Synology oder in der iCloud, in den du vom iPhone Fotos speicherst. Eingelesene Dateien werden in den Unterordner „eingelesen“ verschoben.</p>
        <div className="buttons">
          <span>{e?.eingangsordner ? <b>{e.eingangsordner}</b> : 'kein Ordner gewählt'}</span><span className="spacer" />
          {e?.eingangsordner && <button onClick={async () => { await window.hv.eingangsordnerAus(); reload(); }}>Ausschalten</button>}
          <button className="primary" onClick={async () => { await window.hv.eingangsordnerWaehlen(); reload(); }}>Ordner wählen…</button>
        </div>
      </div>
      <div className="panel">
        <b>E-Mail-Postfach (IMAP)</b>
        <p className="klein hinweis">Anhänge neuer E-Mails (Rechnungen, Bescheide, Verträge, Fotos …) werden alle 15 Minuten abgeholt. Die Mails selbst bleiben unverändert im Postfach. Tipp: ein eigenes Postfach oder einen Unterordner nur für die Verwaltung nehmen.</p>
        <div className="maske">
          <label className="breit">IMAP-Server<input value={w('mail_server')} placeholder="z. B. imap.gmx.net" onChange={(ev) => set('mail_server', ev.target.value)} /></label>
          <label>Port<input value={w('mail_port') || '993'} onChange={(ev) => set('mail_port', ev.target.value)} /></label>
          <label>Ordner<input value={w('mail_ordner') || 'INBOX'} onChange={(ev) => set('mail_ordner', ev.target.value)} /></label>
          <label className="breit">Benutzer<input value={w('mail_benutzer')} onChange={(ev) => set('mail_benutzer', ev.target.value)} /></label>
          <label className="breit">Passwort {e?.mail_passwort_enc || e?.mail_passwort_klar ? '(gespeichert)' : ''}<input type="password" value={pw} placeholder={e?.mail_passwort_enc || e?.mail_passwort_klar ? '••••••••' : ''} onChange={(ev) => setPw(ev.target.value)} /></label>
          <label>Erstmals Mails ab<input type="date" value={w('mail_ab')} onChange={(ev) => set('mail_ab', ev.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={w('mail_texte') === '1'} onChange={(ev) => set('mail_texte', ev.target.checked ? '1' : '0')} /> Mails ohne Anhang als Text ablegen</label>
          <label className="check"><input type="checkbox" checked={w('mail_aktiv') === '1'} onChange={(ev) => set('mail_aktiv', ev.target.checked ? '1' : '0')} /> automatisch abrufen</label>
        </div>
        <div className="buttons">
          {meldung && <span className="meldung">{meldung}</span>}
          <span className="spacer" />
          <button onClick={() => lauf(async () => { await window.hv.mailSpeichern(f ?? {}, pw); setF(null); setPw(''); return window.hv.mailTesten(); })}>Speichern & testen</button>
          <button className="primary" disabled={!e?.mail_server} onClick={() => lauf(async () => { const r = await window.hv.mailAbrufen(); return `${r.mails} neue E-Mail(s), ${r.neu} Dokument(e) ins Postfach.`; })}>Jetzt abrufen</button>
        </div>
        {e?.mail_letzter_abruf && <p className="klein hinweis">Letzter Abruf: {new Date(e.mail_letzter_abruf).toLocaleString('de-DE')}{e.mail_letzter_fehler ? ` · Fehler: ${e.mail_letzter_fehler}` : ''}</p>}
      </div>
    </div>
  );
}
