import { useState } from 'react';
import { call, fehler, type Row } from '../api';
import { useLoad } from '../useLoad';
import { anzeige, SCHRIFTGROESSEN, type Thema } from '../anzeige';
import { Tabs } from '../ui';

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
  ['verwalter_ustid', 'USt-IdNr. (falls vorhanden)'],
  ['datev_berater', 'DATEV Beraternummer'],
  ['datev_mandant', 'DATEV Mandantennummer'],
];

const zeitpunkt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');

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
      <Darstellung />
      <SteuerKalender />
      <Automatik />
      <Festschreibung />
      <ClaudeVerbindung />
      <Dokumenteneingang />
      <div className="block">
        <h3>Datensicherung</h3>
        <p className="hinweis">
          Alle Daten liegen in einer einzigen Datei. Mietshaus legt jeden Tag automatisch eine Sicherung im Ordner „sicherungen“
          daneben ab (die letzten 14 Tage, danach eine je Monat für ein Jahr) und zusätzlich vor jedem Programm-Update.
          Weil diese Sicherungen auf demselben Rechner liegen, sichere zusätzlich regelmäßig auf einen USB-Stick oder in die iCloud.
          Abgelegte Dokumente liegen im Ordner „dokumente“.
        </p>
        <label className="check">
          <input type="checkbox" checked={e?.auto_sicherung !== '0'} onChange={async (ev) => {
            await call('setzeEinstellungen', { auto_sicherung: ev.target.checked ? '1' : '0' });
            reload();
          }} /> Täglich automatisch sichern
        </label>
        <div className="buttons">
          <button className="primary" onClick={async () => {
            try {
              const p = await window.hv.sicherung();
              if (p) setMeldung(`Sicherung gespeichert: ${p}`);
            } catch (err) { fehler(err); }
          }}>Sicherung erstellen…</button>
          <button onClick={async () => {
            // The main process checks the file, compares it with the data in use and asks before anything is replaced.
            try {
              if (await window.hv.wiederherstellen()) location.reload();
            } catch (err) { fehler(err); }
          }}>Sicherung wiederherstellen…</button>
          <button onClick={() => window.hv.sicherungsOrdnerOeffnen()}>Sicherungsordner öffnen</button>
        </div>
        {info && (
          <p className="klein hinweis">
            Datenbank: {info.dbFile}<br />Dokumente: {info.dokumente}<br />Sicherungen: {info.sicherungen}<br />
            Letzte Änderung: {zeitpunkt(info.stand.zeit)}{info.stand.geraet_name ? ` (${info.stand.geraet_name})` : ''} · Dieses Gerät: {info.geraet}<br />
            Letzte automatische Sicherung: {zeitpunkt(info.letzte_auto_sicherung)} · Version {info.version}
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
        Verbindet Mietshaus mit der Claude-Desktop-App (dein Claude-Abo genügt, kein API-Schlüssel nötig). Danach kannst du in
        Claude z. B. sagen: „Arbeite das Postfach im Mietshaus ab“ – Claude liest die Dokumente, legt sie ab und überträgt Rechnungen,
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

const LAENDER: [string, string][] = [['', 'nur bundesweite Feiertage'], ['BW', 'Baden-Württemberg'], ['BY', 'Bayern'], ['BE', 'Berlin'], ['BB', 'Brandenburg'],
  ['HB', 'Bremen'], ['HH', 'Hamburg'], ['HE', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern'], ['NI', 'Niedersachsen'], ['NW', 'Nordrhein-Westfalen'],
  ['RP', 'Rheinland-Pfalz'], ['SL', 'Saarland'], ['SN', 'Sachsen'], ['ST', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thüringen']];

// State for holidays (due dates on working days, notice periods) and VAT settings for commercial lettings.
function SteuerKalender() {
  const [e, reload] = useLoad<Row>(() => call('einstellungen'), []);
  if (!e) return null;
  const setzen = async (k: string, v: string) => { await call('setzeEinstellungen', { [k]: v }); reload(); };
  return (
    <div className="block">
      <h3>Kalender und Umsatzsteuer</h3>
      <div className="maske">
        <label>Bundesland der Häuser (Feiertage)
          <select value={e.bundesland ?? ''} onChange={(ev) => setzen('bundesland', ev.target.value)}>{LAENDER.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label>Umsatzsteuer berechnen nach
          <select value={e.ust_versteuerung ?? 'soll'} onChange={(ev) => setzen('ust_versteuerung', ev.target.value)}>
            <option value="soll">vereinbarten Entgelten (Soll)</option><option value="ist">vereinnahmten Entgelten (Ist)</option>
          </select>
        </label>
        <label>Voranmeldung
          <select value={e.ust_zeitraum ?? 'quartal'} onChange={(ev) => setzen('ust_zeitraum', ev.target.value)}>
            <option value="quartal">vierteljährlich</option><option value="monat">monatlich</option>
          </select>
        </label>
        <label>Nächste Rechnungsnummer<input defaultValue={e.rechnungsnr_naechste ?? `${new Date().getFullYear()}-001`} onBlur={(ev) => setzen('rechnungsnr_naechste', ev.target.value.trim())} /></label>
      </div>
      <p className="klein hinweis">Feiertage verschieben gesetzliche Fälligkeiten („3. Werktag“) und Kündigungsfristen. Umsatzsteuer betrifft nur Gewerbeeinheiten, bei denen du zur Umsatzsteuer optiert hast.</p>
    </div>
  );
}

function Automatik() {
  const [e, reload] = useLoad<Row>(() => call('einstellungen'), []);
  if (!e) return null;
  const an = e.auto_soll !== '0';
  return (
    <div className="block">
      <h3>Automatik</h3>
      <label className="check">
        <input type="checkbox" checked={an} onChange={async (ev) => { await call('setzeEinstellungen', { auto_soll: ev.target.checked ? '1' : '0' }); reload(); }} />
        Monatliche Forderungen (Miete, Vorauszahlungen, Hausgeld) automatisch buchen
      </label>
      <p className="klein hinweis">
        {e.auto_soll_ab ? `Aktiv seit ${e.auto_soll_ab.slice(5)}/${e.auto_soll_ab.slice(0, 4)}; frühere Monate werden nicht automatisch nachgebucht (dafür „Sollstellung“ nutzen).` : 'Startet mit dem aktuellen Monat.'}
        {e.auto_letzter_lauf ? ` Letzter Lauf: ${new Date(e.auto_letzter_lauf).toLocaleString('de-DE')}.` : ''}
      </p>
    </div>
  );
}

function Darstellung() {
  const [thema, setThema] = useState<Thema>(anzeige.thema());
  const [schrift, setSchrift] = useState(anzeige.schrift());
  return (
    <div className="block">
      <h3>Darstellung</h3>
      <div className="toolbar">
        <span>Farbschema</span>
        <Tabs tabs={[['system', 'wie macOS'], ['hell', 'Hell'], ['dunkel', 'Dunkel']]} value={thema} onChange={(t) => { anzeige.setzeThema(t); setThema(t); }} />
        <span style={{ marginLeft: 20 }}>Schriftgröße</span>
        <Tabs tabs={SCHRIFTGROESSEN.map(([f, l]) => [String(f), l] as [string, string])} value={String(schrift)}
          onChange={(f) => { anzeige.setzeSchrift(Number(f)); setSchrift(Number(f)); }} />
      </div>
      <p className="klein hinweis">Gilt für diesen Computer. Die Schrift lässt sich auch jederzeit mit ⌘+ und ⌘− anpassen.</p>
    </div>
  );
}

function Festschreibung() {
  const [e, reload] = useLoad<Row>(() => call('einstellungen'), []);
  const [bis, setBis] = useState(`${new Date().getFullYear() - 1}-12-31`);
  if (!e) return null;
  return (
    <div className="block">
      <h3>Festschreibung (GoBD)</h3>
      <p className="hinweis">
        {e.festgeschrieben_bis ? <>Buchungen bis einschließlich <b>{e.festgeschrieben_bis.split('-').reverse().join('.')}</b> sind festgeschrieben: sie können nicht mehr geändert oder gelöscht, nur storniert werden.</>
          : 'Noch kein Zeitraum festgeschrieben. Nach dem Jahresabschluss bzw. der Abgabe an den Steuerberater sollte das Jahr festgeschrieben werden.'}
      </p>
      <div className="toolbar">
        <label>Festschreiben bis <input type="date" value={bis} onChange={(ev) => setBis(ev.target.value)} /></label>
        <button onClick={async () => {
          if (e.festgeschrieben_bis && bis < e.festgeschrieben_bis) return alert('Eine Festschreibung kann nicht zurückgenommen werden.');
          if (!confirm(`Alle Buchungen bis ${bis.split('-').reverse().join('.')} endgültig festschreiben?`)) return;
          await call('setzeEinstellungen', { festgeschrieben_bis: bis });
          reload();
        }}>Festschreiben</button>
      </div>
    </div>
  );
}
