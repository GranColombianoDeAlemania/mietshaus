// Status of the program: version and updates, space, backups (with the monthly restore test) and signed-in devices.
import { useState } from 'react';
import * as I from 'lucide-react';
import { fehler, type Row } from '../api';
import { anfrage } from '../bruecke';
import { useLoad } from '../useLoad';
import { bestaetigen } from '../frage';

const groesse = (b: number) => (b > 1e9 ? `${(b / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB` : b > 1e6 ? `${(b / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB` : `${Math.round(b / 1e3)} KB`);
const zeit = (iso?: string | null) => (iso ? new Date(iso.replace(' ', 'T')).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
const tageHer = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);

function Zeile(props: { ok: boolean | null; titel: string; children: React.ReactNode }) {
  const Icon = props.ok == null ? I.Minus : props.ok ? I.CircleCheck : I.CircleAlert;
  return (
    <li className={`statuszeile ${props.ok == null ? '' : props.ok ? 'ok' : 'warnung'}`}>
      <Icon size={18} /><div><b>{props.titel}</b><div className="klein hinweis">{props.children}</div></div>
    </li>
  );
}

export function Status() {
  const [s, reload] = useLoad<Row>(() => anfrage('/api/systemstatus').then((r) => r.json()), []);
  const [laeuft, setLaeuft] = useState('');
  const tun = async (was: string, fn: () => Promise<unknown>) => {
    setLaeuft(was);
    try { await fn(); reload(); } catch (e) { fehler(e); } finally { setLaeuft(''); }
  };
  if (!s) return null;
  const d = window.hvDesktop;
  const sich = s.sicherung;
  const platzOk = s.platz ? s.platz.frei > 2e9 && s.platz.frei / s.platz.gesamt > 0.05 : null;
  return (
    <section>
      <div className="toolbar"><h1>Status</h1><span className="hinweis klein">{s.modus === 'server' ? 'Mietshaus-Server' : 'lokal auf diesem Mac'}</span></div>
      <ul className="statusliste">
        <Zeile ok={!s.update} titel={`Version ${s.version}${d ? ` · App ${d.version}` : ''}`}>
          {s.update ? <>Version {s.update.version} ist verfügbar. {s.modus === 'server'
            ? 'Der Server holt sie mit dem nächtlichen Update (DSM-Aufgabenplaner) oder in Container Manager → Projekt → Aktion → Erstellen.'
            : 'Die Mac-App bietet das Update selbst an.'} <button className="link" onClick={() => window.hv.extern(s.update.url)}>Was ist neu?</button></>
            : 'Aktuell.'}
        </Zeile>
        <Zeile ok={!!sich.letzte_auto && tageHer(sich.letzte_auto) < 2 && !sich.fehler} titel="Automatische Sicherung">
          {!sich.automatisch ? 'Ausgeschaltet (Einstellungen → Datensicherung).' : <>Letzte: {zeit(sich.letzte_auto)} · {sich.anzahl} Sicherungen, zusammen {groesse(sich.bytes)}
            {sich.fehler && <> · <b>Fehler am {zeit(sich.fehler.zeit)}: {sich.fehler.fehler}</b></>}</>}
        </Zeile>
        <Zeile ok={sich.test ? sich.test.ok && tageHer(sich.test.zeit) < 35 : null} titel="Test der Wiederherstellung">
          {sich.test ? (sich.test.ok
            ? <>{zeit(sich.test.zeit)}: {sich.test.datei} ließ sich wiederherstellen ({sich.test.zahlen.objekte} Objekte, {sich.test.zahlen.personen} Personen, {sich.test.zahlen.buchungen} Buchungen, {sich.test.zahlen.dokumente} Dokumente).</>
            : <>Fehlgeschlagen am {zeit(sich.test.zeit)}: {sich.test.fehler}</>) : 'Noch nicht getestet – läuft einmal im Monat von selbst.'}
        </Zeile>
        <Zeile ok={platzOk} titel="Speicherplatz">
          {s.platz ? <>{groesse(s.platz.frei)} frei von {groesse(s.platz.gesamt)}</> : 'unbekannt'} · Datenbank {groesse(s.datenbank.bytes)} · {s.dokumente.anzahl} Dokumentdateien, {groesse(s.dokumente.bytes)}
        </Zeile>
        <Zeile ok={s.analyse === 0} titel="Texterkennung">{s.analyse ? `${s.analyse} Dokument(e) werden noch gelesen.` : 'Alle Dokumente gelesen.'}</Zeile>
      </ul>
      <div className="buttons">
        <button disabled={!!laeuft} onClick={() => tun('sichern', () => anfrage('/api/jetzt-sichern', { json: {} }))}>{laeuft === 'sichern' ? 'Sichert …' : 'Jetzt sichern'}</button>
        <button disabled={!!laeuft} onClick={() => tun('test', () => anfrage('/api/sicherungstest', { json: {} }))}>{laeuft === 'test' ? 'Testet …' : 'Sicherung jetzt testen'}</button>
      </div>
      <p className="klein hinweis">Diese Sicherungen liegen auf demselben Gerät{s.modus === 'server' ? ' (der Synology)' : ''}. Gegen einen Ausfall hilft nur eine Kopie woanders – auf der Synology mit Hyper Backup.</p>

      {s.modus === 'server' && (
        <div className="block">
          <h3>Angemeldete Geräte</h3>
          <table className="klein">
            <thead><tr><th>Benutzer</th><th>Gerät</th><th>Angemeldet seit</th><th>Zuletzt aktiv</th><th /></tr></thead>
            <tbody>{s.sitzungen.map((x: Row) => (
              <tr key={x.id}><td>{x.name}{x.eigene ? ' (dieses Gerät)' : ''}</td><td title={x.geraet}>{geraetName(x.geraet)}</td><td>{zeit(x.erstellt)}</td><td>{zeit(x.zuletzt)}</td>
                <td className="aktionen">{!x.eigene && <button onClick={async () => {
                  if (await bestaetigen(`${x.name} auf „${geraetName(x.geraet)}“ abmelden?`)) tun('', () => anfrage('/api/sitzung-beenden', { json: { id: x.id } }));
                }}>Abmelden</button>}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// "Mozilla/5.0 (iPhone; …) … Safari" → "iPhone · Safari"
function geraetName(ua?: string | null) {
  if (!ua) return '–';
  const system = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Gerät';
  const programm = /Electron|Mietshaus/.test(ua) ? 'Mietshaus-App' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${system} · ${programm}`;
}
