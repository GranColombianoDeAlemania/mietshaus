import { useEffect, useState } from 'react';
import { call, fehler, type Row } from '../api';
import { abmelden, anfrage, dateienWaehlen } from '../bruecke';
import { ARTEN, homeBildschirmNoetig, pushAbo, pushAusschalten, pushEinschalten, pushMoeglich } from '../mitteilungen';
import { useLoad } from '../useLoad';
import { anzeige, SCHRIFTGROESSEN, type Thema } from '../anzeige';
import { Tabs } from '../ui';
import { bestaetigen, frage, hinweis } from '../frage';

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
  const [wiederherstellen, setWiederherstellen] = useState(false);
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
      {info?.modus === 'server' && <Benutzer />}
      {window.hvDesktop && <Verbindung />}
      {window.hvDesktop && <ClaudeVerbindung />}
      <Dokumenteneingang />
      <EmailVersand />
      <Mitteilungen />
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
          <button onClick={() => setWiederherstellen(true)}>Sicherung wiederherstellen…</button>
          {window.hvDesktop?.lokal && <button onClick={() => window.hv.sicherungsOrdnerOeffnen()}>Sicherungsordner öffnen</button>}
        </div>
        {wiederherstellen && <Wiederherstellen schliessen={() => setWiederherstellen(false)} />}
        {info && (
          <p className="klein hinweis">
            {info.modus === 'server' ? 'Auf dem Mietshaus-Server. ' : ''}Datenbank: {info.dbFile}<br />Dokumente: {info.dokumente}<br />Sicherungen: {info.sicherungen}<br />
            Letzte Änderung: {zeitpunkt(info.stand?.zeit ?? null)}{info.stand?.geraet_name ? ` (${info.stand.geraet_name})` : ''}{info.geraet ? ` · Dieses Gerät: ${info.geraet}` : ''}<br />
            Letzte automatische Sicherung: {zeitpunkt(info.letzte_auto_sicherung ?? null)} · Version {info.version}
          </p>
        )}
      </div>
    </section>
  );
}

function ClaudeVerbindung() {
  const [st, reload] = useLoad(() => window.hv.claudeStatus(), []);
  const [e, ladeE] = useLoad<Row>(() => call('einstellungen'), []);
  const [meldung, setMeldung] = useState('');
  return (
    <div className="block">
      <h3>Claude Desktop</h3>
      <p className="hinweis">
        Verbindet Mietshaus mit der Claude-Desktop-App (dein Claude-Abo genügt, kein API-Schlüssel nötig). Danach kannst du in
        Claude z. B. sagen: „Arbeite das Postfach im Mietshaus ab“ – Claude liest die Dokumente, legt sie ab und überträgt Rechnungen,
        Verträge, Zählerstände und Termine ins Programm. Alles, was Claude ändert, steht im Änderungsprotokoll und lässt sich dort rückgängig machen.
      </p>
      <label className="check">
        <input type="checkbox" checked={e?.claude_freigabe !== '0'} onChange={async (ev) => {
          await call('setzeEinstellungen', { claude_freigabe: ev.target.checked ? '1' : '0' });
          ladeE();
        }} /> Buchungen, Verträge und Änderungen an Personen (z. B. Bankverbindung) erst nach meiner Freigabe übernehmen (empfohlen)
      </label>
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
        <p className="klein hinweis">Z. B. der Scan-Ordner deines Scanners, ein Ordner auf der Synology oder in der iCloud, in den du vom iPhone Fotos speicherst. Eingelesene Dateien werden in den Unterordner „eingelesen“ verschoben.
          Auf dem Server ist das die Freigabe „eingang“ der Synology.</p>
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
          <label className="breit">Passwort {e?.mail_passwort_enc || e?.mail_passwort_klar || e?.mail_passwort_server ? '(gespeichert)' : ''}<input type="password" value={pw} placeholder={e?.mail_passwort_enc || e?.mail_passwort_klar || e?.mail_passwort_server ? '••••••••' : ''} onChange={(ev) => setPw(ev.target.value)} /></label>
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
          if (e.festgeschrieben_bis && bis < e.festgeschrieben_bis) return hinweis('Eine Festschreibung kann nicht zurückgenommen werden.');
          if (!await bestaetigen(`Alle Buchungen bis ${bis.split('-').reverse().join('.')} endgültig festschreiben?`)) return;
          await call('setzeEinstellungen', { festgeschrieben_bis: bis });
          reload();
        }}>Festschreiben</button>
      </div>
    </div>
  );
}

// Restore: one of the server's own backups or an uploaded file. The server checks it and compares it with the data in
// use; when it is older, or a newer backup of the same data exists (e.g. from another user), that is offered instead.
function Wiederherstellen(props: { schliessen: () => void }) {
  const [liste] = useLoad<Row[]>(() => anfrage('/api/sicherungen').then((r) => r.json()), []);
  const [laeuft, setLaeuft] = useState(false);
  const zeit = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : 'unbekannt');
  const stand = (s: Row) => `${zeit(s.zeit)}${s.geraet ? ` (${s.geraet})` : ''}`;
  const pruefen = async (r: Response) => {
    const p = await r.json();
    const zeilen = [`Gewählte Sicherung: ${p.gewaehlt.name}, Stand ${stand(p.gewaehlt)}`, `Aktueller Datenbestand: Stand ${stand(p.jetzt)}`];
    if (p.anderer_bestand) zeilen.push('', 'Achtung: Die Sicherung gehört zu einem anderen Datenbestand.');
    if (p.aelter) zeilen.push('', 'Die Sicherung ist älter als der aktuelle Datenbestand. Alles, was danach eingetragen wurde – auch von anderen Nutzern –, ginge verloren.');
    if (p.neuere) zeilen.push('', `Neuere Sicherung gefunden: ${p.neuere.name}, Stand ${stand(p.neuere)}.`);
    zeilen.push('', 'Der jetzige Stand wird vorher automatisch gesichert.');
    const wahl = await frage({ titel: 'Sicherung wiederherstellen?', text: <>{zeilen.map((z, i) => (z ? <p key={i}>{z}</p> : <br key={i} />))}</>, optionen: [
      { id: 'nein', label: 'Abbrechen' },
      ...(p.neuere ? [{ id: 'neueste', label: 'Neueste Sicherung verwenden', primary: true }] : []),
      { id: 'ja', label: p.aelter ? 'Trotzdem diese wiederherstellen' : 'Wiederherstellen', primary: !p.neuere },
    ] });
    if (wahl !== 'ja' && wahl !== 'neueste') return;
    await anfrage('/api/sicherung/einspielen', { json: { kennung: p.kennung, neueste: wahl === 'neueste' } });
    location.reload();
  };
  const tun = async (fn: () => Promise<Response | null>) => {
    setLaeuft(true);
    try { const r = await fn(); if (r) await pruefen(r); } catch (err) { fehler(err); } finally { setLaeuft(false); }
  };
  return (
    <div className="panel">
      <div className="kz-zeile"><b>Sicherung wiederherstellen</b><button className="link" onClick={props.schliessen}>Schließen</button></div>
      <div className="buttons">
        <button disabled={laeuft} onClick={() => tun(async () => {
          const [f] = await dateienWaehlen({ endungen: ['sqlite'] });
          return f ? anfrage('/api/sicherung/pruefen', { roh: f, typ: 'application/octet-stream' }) : null;
        })}>Datei hochladen…</button>
      </div>
      {liste && liste.length > 0 && (
        <table className="klein">
          <thead><tr><th>Sicherung auf dem {window.hvDesktop?.lokal ? 'Mac' : 'Server'}</th><th>Stand</th><th /></tr></thead>
          <tbody>{liste.map((s) => (
            <tr key={s.name}><td>{s.name}</td><td>{stand(s)}</td>
              <td className="aktionen"><button disabled={laeuft} onClick={() => tun(() => anfrage(`/api/sicherung/pruefen?name=${encodeURIComponent(s.name)}`, { json: {} }))}>Prüfen…</button></td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

// Users of the server: all with the same rights. A new password ends that user's sessions.
function Benutzer() {
  const [liste, reload] = useLoad<Row[]>(() => call('benutzerListe'), []);
  const [neu, setNeu] = useState({ login: '', name: '', passwort: '' });
  const [meldung, setMeldung] = useState('');
  const tun = async (fn: () => Promise<unknown>, text: string) => {
    try { await fn(); setMeldung(text); reload(); } catch (err) { fehler(err); }
  };
  return (
    <div className="block">
      <h3>Benutzer</h3>
      <p className="hinweis">Alle Benutzer haben dieselben Rechte. Im Änderungsprotokoll steht, wer was geändert hat.</p>
      <table className="klein">
        <thead><tr><th>Name</th><th>Login</th><th>Status</th><th /></tr></thead>
        <tbody>{liste?.map((b) => (
          <tr key={b.id}><td>{b.name}</td><td>{b.login}</td><td>{b.aktiv ? 'aktiv' : 'gesperrt'}{b.claude ? ' · Claude verbunden' : ''}</td>
            <td className="aktionen">
              <button onClick={async () => {
                const pw = window.prompt(`Neues Passwort für ${b.name} (mindestens 10 Zeichen):`);
                if (pw) tun(() => call('benutzerAendern', b.id, { passwort: pw }), 'Passwort geändert; bestehende Anmeldungen sind beendet.');
              }}>Passwort…</button>
              <button onClick={() => tun(() => call('benutzerAendern', b.id, { aktiv: !b.aktiv }), b.aktiv ? 'Gesperrt.' : 'Wieder aktiv.')}>{b.aktiv ? 'Sperren' : 'Entsperren'}</button>
            </td></tr>
        ))}</tbody>
      </table>
      <div className="maske">
        <label>Login<input value={neu.login} onChange={(ev) => setNeu({ ...neu, login: ev.target.value })} /></label>
        <label>Name<input value={neu.name} onChange={(ev) => setNeu({ ...neu, name: ev.target.value })} /></label>
        <label>Passwort<input type="password" autoComplete="new-password" value={neu.passwort} onChange={(ev) => setNeu({ ...neu, passwort: ev.target.value })} /></label>
      </div>
      <div className="buttons">
        <button className="primary" disabled={!neu.login || !neu.passwort} onClick={() => tun(async () => { await call('benutzerAnlegen', neu); setNeu({ login: '', name: '', passwort: '' }); }, 'Benutzer angelegt.')}>Benutzer anlegen</button>
        <button onClick={() => abmelden().then(() => location.reload())}>Abmelden</button>
        {meldung && <span className="meldung">{meldung}</span>}
      </div>
    </div>
  );
}

// Mac app only: work on this Mac (local) or with the Mietshaus server on the NAS.
function Verbindung() {
  const [v, reload] = useLoad(() => window.hvDesktop!.verbindung(), []);
  const [adresse, setAdresse] = useState<string | null>(null);
  const [fortschritt, setFortschritt] = useState('');
  useEffect(() => window.hvDesktop!.bei('fortschritt', setFortschritt), []);
  if (!v) return null;
  const wert = adresse ?? v.adresse ?? '';
  return (
    <div className="block">
      <h3>Verbindung</h3>
      <p className="hinweis">
        <b>Server:</b> Alle arbeiten mit derselben Datenbank auf der Synology, erreichbar über Tailscale (z. B. https://nas.dein-tailnet.ts.net).
        <b> Lokal:</b> Die Daten liegen nur auf diesem Mac, z. B. zum Arbeiten ohne Verbindung. Zwischen beiden wird nichts abgeglichen.
      </p>
      <div className="maske">
        <label className="breit">Server-Adresse<input value={wert} placeholder="https://nas.dein-tailnet.ts.net" onChange={(ev) => setAdresse(ev.target.value)} /></label>
      </div>
      <div className="buttons">
        <span>Jetzt: <b>{v.art === 'server' ? `Server ${v.adresse}` : 'lokal auf diesem Mac'}</b></span><span className="spacer" />
        {v.art === 'server' && <button onClick={() => window.hvDesktop!.verbindungSetzen('lokal').then(reload)}>Lokal arbeiten</button>}
        <button className="primary" disabled={!/^https?:\/\/\S+$/.test(wert)} onClick={() => window.hvDesktop!.verbindungSetzen('server', wert.trim()).then(reload)}>Mit Server verbinden</button>
      </div>
      {v.art === 'server' && (
        <div className="buttons">
          <span className="klein hinweis">Einmalig: die Daten und Dokumente dieses Macs in den noch leeren Server übernehmen.</span><span className="spacer" />
          <button onClick={async () => {
            if (!await bestaetigen('Datenbank und alle Dokumente dieses Macs auf den Server übertragen? Das geht nur, solange der Server noch leer ist.', { ja: 'Übertragen' })) return;
            try { await window.hvDesktop!.datenUebertragen(); location.reload(); } catch (err) { setFortschritt(''); fehler(err); }
          }}>Daten dieses Macs übertragen…</button>
        </div>
      )}
      {fortschritt && <p className="meldung">{fortschritt}</p>}
    </div>
  );
}

// Sending e-mails (SMTP): the server sends mails written in Mietshaus and files them in the archive.
function EmailVersand() {
  const [e, reload] = useLoad<Row>(() => call('einstellungen'), []);
  const [f, setF] = useState<Row | null>(null);
  const [pw, setPw] = useState('');
  const [meldung, setMeldung] = useState('');
  const w = (k: string) => f?.[k] ?? e?.[k] ?? '';
  const set = (k: string, v: string) => setF({ ...(f ?? {}), [k]: v });
  const speichernUndTesten = async () => {
    setMeldung('…');
    try {
      await anfrage('/api/smtp/speichern', { json: { cfg: f ?? {}, pw: pw || undefined } });
      setF(null); setPw('');
      window.dispatchEvent(new Event('hv-smtp-geaendert'));
      setMeldung((await (await anfrage('/api/smtp/testen', { json: {} })).json()).text);
    } catch (err) { setMeldung(`Fehler: ${(err as Error).message}`); }
    reload();
  };
  return (
    <div className="block">
      <h3>E-Mail-Versand</h3>
      <p className="hinweis">Damit sendet Mietshaus E-Mails selbst – mit Dokumenten aus dem Archiv als Anhang – und legt jede gesendete E-Mail im Archiv ab.
        Ohne Einrichtung öffnet „E-Mail“ wie bisher dein Mailprogramm.</p>
      <div className="maske">
        <label className="breit">SMTP-Server<input value={w('smtp_server')} placeholder="z. B. mail.gmx.net" onChange={(ev) => set('smtp_server', ev.target.value)} /></label>
        <label>Port<input value={w('smtp_port') || (w('smtp_ssl') === 'ssl' ? '465' : '587')} onChange={(ev) => set('smtp_port', ev.target.value)} /></label>
        <label>Verschlüsselung<select value={w('smtp_ssl') || 'starttls'} onChange={(ev) => set('smtp_ssl', ev.target.value)}>
          <option value="starttls">STARTTLS (Port 587)</option><option value="ssl">SSL/TLS (Port 465)</option></select></label>
        <label className="breit">Benutzer<input value={w('smtp_benutzer')} onChange={(ev) => set('smtp_benutzer', ev.target.value)} /></label>
        <label className="breit">Passwort {e?.smtp_passwort_server || e?.smtp_passwort_enc || e?.smtp_passwort_klar ? '(gespeichert)' : '(leer = wie beim Abrufen, wenn gleicher Benutzer)'}
          <input type="password" value={pw} onChange={(ev) => setPw(ev.target.value)} /></label>
        <label className="breit">Absender<input value={w('smtp_absender')} placeholder="Hausverwaltung Muster <info@beispiel.de>" onChange={(ev) => set('smtp_absender', ev.target.value)} /></label>
        <label className="check"><input type="checkbox" checked={w('smtp_kopie') === '1'} onChange={(ev) => set('smtp_kopie', ev.target.checked ? '1' : '0')} /> Kopie an mich (Absender)</label>
      </div>
      <div className="buttons">
        {meldung && <span className="meldung">{meldung}</span>}<span className="spacer" />
        <button className="primary" onClick={speichernUndTesten}>Speichern & testen</button>
      </div>
    </div>
  );
}

// Notifications on this device: Web Push in the browser / home-screen app, macOS notifications in the Mac app.
function Mitteilungen() {
  const [abo, ladeAbo] = useLoad(() => pushAbo().then(async (a) => (a ? { a, arten: (await (await anfrage('/api/push/status', { json: { endpoint: a.endpoint } })).json())?.arten?.split(',') ?? [] } : null)), []);
  const [arten, setArten] = useState<string[] | null>(null);
  const [meldung, setMeldung] = useState('');
  const [desktopAn, setDesktopAn] = useState(() => { try { return localStorage.getItem('mitteilungen') !== '0'; } catch { return true; } });
  const gewaehlt: string[] = arten ?? abo?.arten ?? ARTEN.map(([k]) => k);
  const tun = async (fn: () => Promise<unknown>, text: string) => {
    try { await fn(); setMeldung(text); ladeAbo(); } catch (e) { setMeldung(`Fehler: ${(e as Error).message}`); }
  };
  if (window.hvDesktop) {
    return (
      <div className="block">
        <h3>Mitteilungen</h3>
        <label className="check"><input type="checkbox" checked={desktopAn} onChange={(e) => {
          setDesktopAn(e.target.checked);
          try { localStorage.setItem('mitteilungen', e.target.checked ? '1' : '0'); } catch {}
        }} /> macOS-Mitteilungen zeigen (neue Dokumente, zugewiesene Vorgänge, Probleme mit der Sicherung), solange Mietshaus läuft und nicht im Vordergrund ist</label>
        <p className="klein hinweis">Auf dem iPhone kommen Mitteilungen auch bei geschlossener App: Mietshaus dort im Browser öffnen, zum Home-Bildschirm hinzufügen und hier unter Einstellungen einschalten.</p>
      </div>
    );
  }
  return (
    <div className="block">
      <h3>Mitteilungen auf diesem Gerät</h3>
      {!pushMoeglich() ? <p className="hinweis">Dieser Browser kann keine Mitteilungen empfangen.</p>
        : homeBildschirmNoetig() ? <p className="hinweis">Auf iPhone und iPad gehen Mitteilungen nur für Mietshaus auf dem Home-Bildschirm: unten auf <b>Teilen → Zum Home-Bildschirm</b> tippen, Mietshaus von dort öffnen und hier einschalten.</p>
          : <>
            <p className="hinweis">Mitteilungen kommen auch, wenn Mietshaus geschlossen ist.</p>
            {ARTEN.map(([k, l]) => (
              <label key={k} className="check"><input type="checkbox" checked={gewaehlt.includes(k)}
                onChange={(e) => setArten(e.target.checked ? [...gewaehlt, k] : gewaehlt.filter((x: string) => x !== k))} /> {l}</label>
            ))}
            <div className="buttons">
              {meldung && <span className="meldung">{meldung}</span>}<span className="spacer" />
              {abo && <button onClick={() => tun(pushAusschalten, 'Ausgeschaltet.')}>Ausschalten</button>}
              {abo && <button onClick={() => tun(async () => { const r = await (await anfrage('/api/push/test', { json: {} })).json(); if (!r.gesendet) throw new Error('nichts gesendet'); }, 'Test gesendet.')}>Test senden</button>}
              <button className="primary" onClick={() => tun(() => pushEinschalten(gewaehlt), 'Eingeschaltet.')}>{abo ? 'Auswahl speichern' : 'Einschalten'}</button>
            </div>
          </>}
    </div>
  );
}
