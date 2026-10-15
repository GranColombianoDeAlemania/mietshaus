// Cockpit: what needs attention, what is coming up, opportunities, key figures and cash flow.
import { useState } from 'react';
import { call, datum, euro, type Modus, type Row } from '../api';
import { useLoad } from '../useLoad';
import { ObjektKacheln } from './Steckbrief';

const STUFE: Record<string, [string, string]> = { rot: ['●', 'Jetzt handeln'], orange: ['●', 'Bald / prüfen'], gelb: ['●', 'Chance / Hinweis'] };

export function Uebersicht(props: { modus: Modus; objekte: Row[]; oeffne: (seite: string, objektId?: number) => void }) {
  const [hinweise, reload] = useLoad<Row[]>(() => call('hinweise'), []);
  const [k] = useLoad<Row>(() => call('kennzahlen', props.modus), [props.modus]);
  const [d] = useLoad<Row>(() => call('uebersicht', props.modus), [props.modus]);
  const [f] = useLoad<Row>(() => call('faelligkeiten', 7), []);
  const [vorgaenge] = useLoad<Row[]>(() => call('vorgaengeListe', null, true), []);
  const weg = props.modus === 'weg';
  if (!hinweise || !k || !d || !f) return null;

  // Hints of objects that belong to the other mode stay out of this cockpit.
  const sichtbar = new Set(props.objekte.map((o) => o.id));
  const meine = hinweise.filter((h) => (!h.objekt_id || sichtbar.has(h.objekt_id)) && (!h.modus || h.modus === props.modus));
  const handeln = meine.filter((h) => h.stufe !== 'gelb');
  const chancen = meine.filter((h) => h.stufe === 'gelb');
  const rot = handeln.filter((h) => h.stufe === 'rot').length;
  const offeneVorgaenge = (vorgaenge ?? []).filter((v) => v.faellig && v.faellig <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const eingangQuote = k.soll_ct ? Math.min(100, Math.round((k.ist_ct / k.soll_ct) * 100)) : 0;

  return (
    <section className="cockpit">
      <div className="toolbar"><h1>{weg ? 'WEG-Verwaltung' : 'Mietverwaltung'} – Cockpit</h1></div>
      <p className="kurzlage">
        {handeln.length === 0 ? 'Alles erledigt – nichts braucht gerade deine Aufmerksamkeit.'
          : `${handeln.length} ${handeln.length === 1 ? 'Punkt braucht' : 'Punkte brauchen'} deine Aufmerksamkeit${rot ? `, davon ${rot} dringend` : ''}.`}
        {chancen.length > 0 && ` ${chancen.length} ${chancen.length === 1 ? 'Chance' : 'Chancen'} erkannt.`}
        {f.termine.length + offeneVorgaenge.length > 0 && ` Diese Woche: ${f.termine.length} Termin(e), ${offeneVorgaenge.length} fällige Vorgänge.`}
      </p>

      <ObjektKacheln modus={props.modus} oeffne={props.oeffne} />
      <div className="kacheln">
        {k.soll_ct > 0 && (
          <div className="kachel">
            <div className="wert">{euro(k.ist_ct)}</div>
            <div className="label">{weg ? 'Hausgeld' : 'Mieten'}-Eingang {k.monat.slice(5)}/{k.monat.slice(0, 4)} von {euro(k.soll_ct)} Soll</div>
            <div className="balken" title={`${eingangQuote} %`}><span style={{ width: `${eingangQuote}%` }} /></div>
          </div>
        )}
        <div className="kachel"><div className="wert">{euro(k.geld_ct)}</div><div className="label">Kontostände gesamt</div></div>
        <div className="kachel"><div className="wert">{euro(d.soll_monat_ct)}</div><div className="label">{weg ? 'Hausgeld-Soll' : 'Mieten-Soll'} pro Monat</div></div>
        {!weg && <div className="kachel"><div className="wert">{k.einheiten ? Math.round(((k.einheiten - k.vermietet) / k.einheiten) * 100) : 0} %</div><div className="label">Leerstand ({Math.max(0, k.einheiten - k.vermietet)} von {k.einheiten} Einheiten)</div></div>}
      </div>

      <div className="cockpit-raster">
        <div className="panel">
          <h3>Zu erledigen</h3>
          {handeln.length === 0 && <p className="hinweis">Nichts offen.</p>}
          <ul className="hinweisliste">
            {handeln.map((h) => <Hinweis key={h.schluessel} h={h} oeffne={props.oeffne} reload={reload} />)}
          </ul>
        </div>
        <div>
          <div className="panel">
            <h3>Diese Woche</h3>
            {f.termine.length + offeneVorgaenge.length === 0 && <p className="hinweis">Keine Termine oder fälligen Vorgänge.</p>}
            <ul className="hinweisliste">
              {f.termine.map((t: Row) => (
                <li key={'t' + t.id} className="klickbar" onClick={() => props.oeffne('termine')}>
                  <div className="inhalt"><div>📅 {t.titel}</div><div className="klein hinweis">{datum(t.datum)} {t.uhrzeit}{t.objekt ? ` · ${t.objekt}` : ''}</div></div>
                </li>
              ))}
              {offeneVorgaenge.map((v) => (
                <li key={'v' + v.id} className="klickbar" onClick={() => props.oeffne('vorgaenge', v.objekt_id)}>
                  <div className="inhalt"><div>📌 {v.titel}</div><div className="klein hinweis">fällig {datum(v.faellig)}{v.objekt ? ` · ${v.objekt}` : ''}</div></div>
                </li>
              ))}
            </ul>
          </div>
          {chancen.length > 0 && (
            <div className="panel">
              <h3>Chancen & Hinweise</h3>
              <ul className="hinweisliste">{chancen.map((h) => <Hinweis key={h.schluessel} h={h} oeffne={props.oeffne} reload={reload} />)}</ul>
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <h3>Ein- und Auszahlungen der letzten 12 Monate</h3>
        <Zahlungsverlauf verlauf={k.verlauf} />
      </div>

      {d.objekte === 0 && (
        <div className="hinweis">
          <p><b>So geht's los:</b></p>
          <ol>
            <li>Unter <i>Objekte</i> ein Haus anlegen. Häuser mit Mietern und Eigentümern anlegen als „Miet/WEG gemischt“.</li>
            <li>Unter <i>Einheiten</i> die Wohnungen, Garagen usw. erfassen.</li>
            <li>Verträge, Rechnungen und Bescheide einfach ins Fenster ziehen – sie landen im Postfach.</li>
          </ol>
        </div>
      )}
    </section>
  );
}

function Hinweis(props: { h: Row; oeffne: (seite: string, objektId?: number) => void; reload: () => void }) {
  const h = props.h;
  const setzen = async (status: string, tage?: number) => { await call('hinweisSetzen', h.schluessel, status, tage); props.reload(); };
  return (
    <li className={`hinweis-${h.stufe}`}>
      <span className="punkt" title={STUFE[h.stufe][1]} aria-label={STUFE[h.stufe][1]}>{STUFE[h.stufe][0]}</span>
      <div className="inhalt">
        <div>{h.text}</div>
        <div className="klein hinweis">{h.kategorie}{h.objekt ? ` · ${h.objekt}` : ''}</div>
      </div>
      <div className="aktionen">
        {h.ziel && <button onClick={() => props.oeffne(h.ziel, h.objekt_id)}>Öffnen</button>}
        {!h.dauerhaft && <button title="30 Tage ausblenden" onClick={() => setzen('ignoriert', 30)}>Später</button>}
        {!h.dauerhaft && <button title="Als erledigt markieren" onClick={() => setzen('erledigt')}>✓</button>}
      </div>
    </li>
  );
}

// Grouped bars per month: inflows (slot 1, blue) and outflows (slot 2, orange); hover shows both values.
const FARBEN = { ein: 'var(--c1)', aus: 'var(--c2)' };
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function Zahlungsverlauf(props: { verlauf: Row[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [tabelle, setTabelle] = useState(false);
  const v = props.verlauf;
  const max = Math.max(1, ...v.flatMap((m) => [m.ein_ct, m.aus_ct]));
  // Axis maximum: four gridline steps of 1, 2, 2.5 or 5 × 10^n euros that just cover the largest bar.
  const roh = max / 4;
  const basis = 10 ** Math.floor(Math.log10(roh));
  const schritt = [1, 2, 2.5, 5, 10].map((f) => f * basis).find((x) => x >= roh)!;
  const oben = schritt * 4;
  const B = 760, H = 220, L = 56, U = 26, T = 10;
  const breite = (B - L) / v.length;
  const balken = Math.min(18, (breite - 10) / 2);
  const y = (ct: number) => T + (H - T - U) * (1 - ct / oben);
  const kurz = (ct: number) => new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(ct / 100) + ' €';
  const leer = v.every((m) => !m.ein_ct && !m.aus_ct);

  if (leer) return <p className="hinweis">Noch keine Bankbuchungen – der Verlauf erscheint, sobald Zahlungen gebucht sind.</p>;
  return (
    <div className="diagramm">
      <div className="legende">
        <span><i style={{ background: FARBEN.ein }} /> Einzahlungen</span>
        <span><i style={{ background: FARBEN.aus }} /> Auszahlungen</span>
        <span className="spacer" />
        <button className="link" onClick={() => setTabelle(!tabelle)}>{tabelle ? 'Diagramm' : 'Tabelle'}</button>
      </div>
      {tabelle ? (
        <table>
          <thead><tr><th>Monat</th><th className="num">Einzahlungen</th><th className="num">Auszahlungen</th><th className="num">Saldo</th></tr></thead>
          <tbody>{v.map((m) => <tr key={m.monat}><td>{m.monat.slice(5)}/{m.monat.slice(0, 4)}</td><td className="num">{euro(m.ein_ct)}</td><td className="num">{euro(m.aus_ct)}</td><td className="num">{euro(m.ein_ct - m.aus_ct)}</td></tr>)}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label="Ein- und Auszahlungen pro Monat" onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((q) => (
            <g key={q}>
              <line x1={L} x2={B} y1={y(oben * q)} y2={y(oben * q)} style={{ stroke: q === 0 ? 'var(--achse)' : 'var(--raster)' }} strokeWidth={1} />
              <text x={L - 8} y={y(oben * q) + 4} textAnchor="end" fontSize={11} style={{ fill: 'var(--achsentext)' }}>{kurz(oben * q)}</text>
            </g>
          ))}
          {v.map((m, i) => {
            const x = L + i * breite + breite / 2;
            const bar = (ct: number, dx: number, farbe: string) => {
              const h = Math.max(0, y(0) - y(ct));
              if (!h) return null;
              // Rounded top, square base on the axis.
              const r = Math.min(4, h, balken / 2);
              const x0 = x + dx, x1 = x0 + balken, y0 = y(ct), yb = y(0);
              return <path d={`M${x0},${yb} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x1 - r} Q${x1},${y0} ${x1},${y0 + r} V${yb} Z`} style={{ fill: farbe }} />;
            };
            return (
              <g key={m.monat} onMouseEnter={() => setHover(i)}>
                <rect x={L + i * breite} y={T} width={breite} height={H - T - U} fill={hover === i ? 'rgba(0,0,0,0.04)' : 'transparent'} />
                {bar(m.ein_ct, -balken - 1, FARBEN.ein)}
                {bar(m.aus_ct, 1, FARBEN.aus)}
                <text x={x} y={H - 8} textAnchor="middle" fontSize={11} style={{ fill: 'var(--achsentext)' }}>{MONATE[Number(m.monat.slice(5)) - 1]}</text>
              </g>
            );
          })}
        </svg>
      )}
      {hover != null && !tabelle && (
        <div className="tooltip" style={{ left: `${((L + hover * breite + breite / 2) / B) * 100}%` }}>
          <b>{MONATE[Number(v[hover].monat.slice(5)) - 1]} {v[hover].monat.slice(0, 4)}</b>
          <div><i style={{ background: FARBEN.ein }} /> Ein {euro(v[hover].ein_ct)}</div>
          <div><i style={{ background: FARBEN.aus }} /> Aus {euro(v[hover].aus_ct)}</div>
          <div className="klein">Saldo {euro(v[hover].ein_ct - v[hover].aus_ct)}</div>
        </div>
      )}
    </div>
  );
}
