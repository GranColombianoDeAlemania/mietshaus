// Gauges and small charts for key figures. One look everywhere: a ring (value inside), a mini ring for lists, a scale
// with a range, a payment calendar, a timeline, sparkline, bars and a ring chart. Sizes are fixed and small; colours
// come from the theme tokens (zones: --rot, --gelb, --gruen; charts: --k1 … --k8).
import { useState, type ReactNode } from 'react';
import { datum, euro, type Row } from './api';
import { L, type Ziel } from './navi';

export const euro0 = (ct: number | null | undefined) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Math.round((ct ?? 0) / 100) || 0);
export const prozent = (x: number | null | undefined, d = 0) => (x == null ? '–' : `${x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
export const qm = (ct: number | null | undefined) => (ct == null ? '–' : `${(ct / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/m²`);

// Zones: [upper bound, colour] in ascending order; the value takes the colour of the first zone it fits in.
export type Zonen = [number, 'rot' | 'gelb' | 'gruen'][];
export const ZONEN_QUOTE: Zonen = [[79.999, 'rot'], [97.999, 'gelb'], [100, 'gruen']];
export const ZONEN_SCORE: Zonen = [[59.999, 'rot'], [84.999, 'gelb'], [100, 'gruen']];
export const ZONEN_KAUTION: Zonen = [[66.999, 'rot'], [99.999, 'gelb'], [100, 'gruen']];
const zoneVon = (wert: number, zonen: Zonen) => (zonen.find(([bis]) => wert <= bis) ?? zonen[zonen.length - 1])[1];

// Ring gauge (S2): the arc shows the value against the maximum, in the colour of its zone.
export function Ring(props: { wert: number | null; max?: number; zonen?: Zonen; text?: string; klein?: boolean; titel?: string }) {
  const max = props.max ?? 100;
  const w = props.wert;
  const r = props.klein ? 7 : 26, sw = props.klein ? 3 : 5.5, gr = props.klein ? 18 : 60;
  const c = gr / 2, u = 2 * Math.PI * r;
  const anteil = w == null ? 0 : Math.max(0, Math.min(1, w / max));
  const farbe = w == null ? 'var(--leise)' : `var(--${zoneVon(w, props.zonen ?? ZONEN_QUOTE)})`;
  const text = props.text ?? (w == null ? '–' : `${Math.round(w)}`);
  return (
    <svg className={`ring${props.klein ? ' klein' : ''}`} width={gr} height={gr} viewBox={`0 0 ${gr} ${gr}`} role="img" aria-label={props.titel ?? text}>
      {props.titel && <title>{props.titel}</title>}
      <circle cx={c} cy={c} r={r} fill="none" style={{ stroke: 'var(--raster)' }} strokeWidth={sw} />
      {anteil > 0 && <circle cx={c} cy={c} r={r} fill="none" style={{ stroke: farbe }} strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${(u * anteil).toFixed(2)} ${u.toFixed(2)}`} transform={`rotate(-90 ${c} ${c})`} />}
      {!props.klein && <text x={c} y={c + 4.5} textAnchor="middle" className="ring-text">{text}</text>}
    </svg>
  );
}

// Mini gauge for table cells: ring plus the value next to it.
export function MiniRing(props: { wert: number | null; zonen?: Zonen; text?: string; titel?: string }) {
  if (props.wert == null) return <span className="hinweis">–</span>;
  return <span className="miniring" title={props.titel}><Ring wert={props.wert} zonen={props.zonen} klein titel={props.titel} />{props.text ?? Math.round(props.wert)}</span>;
}

// A key figure tile; breite = columns of 12. Links to the list behind a figure sit at the bottom right (fuss),
// so titles always have their full width; aktion is for a small edit button next to the title.
export function Kennzahl(props: { titel: ReactNode; breite?: number; aktion?: ReactNode; fuss?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`kz b${props.breite ?? 3}${props.className ? ' ' + props.className : ''}`}>
      <div className="kz-kopf"><h3>{props.titel}</h3>{props.aktion}</div>
      {props.children}
      {props.fuss && <div className="kz-fuss">{props.fuss}</div>}
    </section>
  );
}

// Ring with the main figure and explanation lines next to it.
export function RingZeile(props: { ring: ReactNode; wert: ReactNode; children?: ReactNode }) {
  return (
    <div className="kz-ringzeile">
      {props.ring}
      <div className="kz-ringtext"><div className="kz-wert">{props.wert}</div>{props.children}</div>
    </div>
  );
}

// Scale with a shaded range (e.g. the rent index span), its middle and markers (this flat, house average).
export function Skala(props: { von?: number | null; bis?: number | null; mitte?: number | null; marken: { wert: number | null; label: string; haupt?: boolean }[]; format: (x: number) => string }) {
  const werte = [props.von, props.bis, props.mitte, ...props.marken.map((m) => m.wert)].filter((x): x is number => x != null);
  if (!werte.length) return null;
  const lo = Math.min(...werte), hi = Math.max(...werte);
  const pad = Math.max((hi - lo) * 0.18, hi * 0.04, 1);
  const a = lo - pad, b = hi + pad;
  const B = 280, x = (v: number) => 8 + (B - 16) * (v - a) / (b - a);
  const marken = props.marken.filter((m) => m.wert != null) as { wert: number; label: string; haupt?: boolean }[];
  return (
    <svg className="skala" viewBox={`0 0 ${B} 46`} role="img" aria-label={marken.map((m) => `${m.label} ${props.format(m.wert)}`).join(', ')}>
      <rect x={8} y={20} width={B - 16} height={6} rx={3} style={{ fill: 'var(--raster)' }} />
      {props.von != null && props.bis != null && <rect x={x(props.von)} y={20} width={Math.max(2, x(props.bis) - x(props.von))} height={6} rx={3} style={{ fill: 'var(--gruen-bg)', stroke: 'var(--gruen)' }} strokeWidth={0.8} />}
      {props.mitte != null && <line x1={x(props.mitte)} x2={x(props.mitte)} y1={17} y2={29} style={{ stroke: 'var(--gruen)' }} strokeWidth={1.5} />}
      {marken.filter((m) => !m.haupt).map((m, i) => (
        <g key={i}><line x1={x(m.wert)} x2={x(m.wert)} y1={15} y2={31} style={{ stroke: 'var(--muted)' }} strokeWidth={1.5} />
          <text x={x(m.wert)} y={42} textAnchor="middle" className="skala-text">{m.label}</text></g>
      ))}
      {marken.filter((m) => m.haupt).map((m, i) => (
        <g key={i}><circle cx={x(m.wert)} cy={23} r={5} style={{ fill: 'var(--ink)', stroke: 'var(--panel)' }} strokeWidth={1.5} />
          <text x={x(m.wert)} y={11} textAnchor="middle" className="skala-text haupt">{props.format(m.wert)}</text></g>
      ))}
    </svg>
  );
}

// Payment calendar: one row per year, one square per month, coloured by on time, late (with the days), open;
// details on hover.
const KAL: Record<string, string> = { puenktlich: 'pünktlich', verspaetet: 'verspätet', offen: 'offen', kuenftig: 'noch nicht fällig', keine: 'keine Forderung' };
const MONATSBUCHSTABEN = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
export function Zahlungskalender(props: { monate: Row[] }) {
  const [aktiv, setAktiv] = useState<Row | null>(null);
  const info = (m: Row) => m.status === 'keine' ? `${monatName(m.monat)}: keine Forderung`
    : `${monatName(m.monat)}: ${euro(m.soll_ct)} fällig am ${datum(m.datum)} – ${m.status === 'puenktlich' ? `bezahlt am ${datum(m.beglichen)}`
      : m.status === 'verspaetet' ? `bezahlt am ${datum(m.beglichen)}, ${m.tage} Tage zu spät` : m.status === 'offen' ? `offen seit ${m.tage} Tagen${m.bezahlt_ct ? ` (bezahlt ${euro(m.bezahlt_ct)})` : ''}`
        : m.bezahlt_ct ? `im Voraus bezahlt ${euro(m.bezahlt_ct)}` : 'noch nicht fällig'}`;
  const jahre = [...new Set(props.monate.map((m) => m.monat.slice(0, 4)))];
  const nachMonat = new Map(props.monate.map((m) => [m.monat, m]));
  return (
    <div className="kalender-wrap">
      <div className="zahlkalender" onMouseLeave={() => setAktiv(null)}>
        <span />{MONATSBUCHSTABEN.map((b, i) => <span key={i} className="zk-kopf">{b}</span>)}
        {jahre.map((j) => [
          <span key={j} className="zk-jahr">{j}</span>,
          ...MONATSBUCHSTABEN.map((_, i) => {
            const m = nachMonat.get(`${j}-${String(i + 1).padStart(2, '0')}`);
            return m ? (
              <span key={m.monat} className={`zk zk-${m.status}`} title={info(m)} onMouseEnter={() => setAktiv(m)}>{m.status === 'verspaetet' ? m.tage : ''}</span>
            ) : <span key={`${j}-${i}`} className="zk zk-ausserhalb" />;
          }),
        ])}
      </div>
      <div className="klein hinweis kal-info">{aktiv ? info(aktiv) : 'Zeig auf einen Monat für Fälligkeit, Zahltag und Betrag. Die Zahl sind die Tage Verspätung.'}</div>
      <div className="legende klein">{['puenktlich', 'verspaetet', 'offen', 'keine'].map((s) => <span key={s}><i className={`zk zk-${s}`} />{KAL[s]}</span>)}</div>
    </div>
  );
}
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const monatName = (m: string) => `${MONATE[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// Small line chart of an account over time: above zero arrears (red area), below zero credit.
export function Sparkline(props: { punkte: { datum: string; ct: number }[]; hoehe?: number }) {
  const p = props.punkte;
  if (p.length < 2) return <p className="hinweis klein">Noch zu wenige Monate für einen Verlauf.</p>;
  const B = 300, H = props.hoehe ?? 64, T = 6, U = 6;
  const max = Math.max(0, ...p.map((x) => x.ct)), min = Math.min(0, ...p.map((x) => x.ct));
  const span = max - min || 1;
  const x = (i: number) => 4 + (B - 8) * i / (p.length - 1);
  const y = (ct: number) => T + (H - T - U) * (max - ct) / span;
  const linie = p.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(q.ct).toFixed(1)}`).join(' ');
  const flaeche = `${linie} L${x(p.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`Verlauf von ${datum(p[0].datum)} bis ${datum(p[p.length - 1].datum)}`}>
      <line x1={0} x2={B} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--achse)' }} strokeWidth={1} />
      <path d={flaeche} style={{ fill: max > 0 ? 'var(--rot-bg)' : 'var(--gruen-bg)' }} />
      <path d={linie} fill="none" style={{ stroke: max > 0 ? 'var(--rot)' : 'var(--c1)' }} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={x(p.length - 1)} cy={y(p[p.length - 1].ct)} r={2.6} style={{ fill: p[p.length - 1].ct > 0 ? 'var(--rot)' : 'var(--c1)' }} />
    </svg>
  );
}

// Occupancy timeline: tenancies, self-use and vacancy as bars over time; each tenancy links to its contract.
export function Zeitstrahl(props: { segmente: Row[]; von: string; bis: string }) {
  const s = props.segmente;
  if (!s.length) return <p className="hinweis klein">Noch keine Belegung erfasst.</p>;
  const a = Date.parse(props.von), b = Date.parse(props.bis) + 864e5;
  const pos = (d: string) => (Date.parse(d) - a) / (b - a) * 100;
  const breite = (x: Row) => Math.max(0.6, pos(nach(x.bis)) - pos(x.von));
  const jahre: number[] = [];
  for (let j = new Date(a).getUTCFullYear() + 1; j <= new Date(b).getUTCFullYear(); j++) jahre.push(j);
  return (
    <div className="zeitstrahl">
      <div className="zs-bahn">
        {s.map((x, i) => {
          const titel = x.art === 'miete' ? `${x.name}: ${datum(x.von)} – ${datum(x.bis)}` : x.art === 'selbst' ? `selbst genutzt: ${datum(x.von)} – ${datum(x.bis)}`
            : `leer ${x.tage} Tage: ${datum(x.von)} – ${datum(x.bis)}${x.entgangen_ct ? ` · entgangene Kaltmiete ${euro0(x.entgangen_ct)}` : ''}`;
          const inhalt = <span className="zs-label">{x.art === 'miete' ? x.name.split(',')[0] : x.art === 'selbst' ? 'selbst' : `${x.tage} T.`}</span>;
          return (
            <span key={i} className={`zs zs-${x.art}`} style={{ left: `${pos(x.von)}%`, width: `${breite(x)}%` }} title={titel}>
              {x.art === 'miete' ? <L zu={{ vertrag: x.vertrag_id, typ: 'miete' }}>{inhalt}</L> : inhalt}
            </span>
          );
        })}
      </div>
      <div className="zs-achse">{jahre.map((j) => <span key={j} style={{ left: `${pos(`${j}-01-01`)}%` }}>{j}</span>)}</div>
    </div>
  );
}
const nach = (iso: string) => new Date(Date.parse(iso) + 864e5).toISOString().slice(0, 10);

// Grouped bars per year (e.g. cold rent charged, paid and the unit's costs).
export function Balken(props: { gruppen: { label: string; werte: number[] }[]; reihen: { label: string; farbe: string }[]; format?: (ct: number) => string }) {
  const g = props.gruppen;
  if (!g.length) return <p className="hinweis klein">Noch keine Werte.</p>;
  const max = Math.max(1, ...g.flatMap((x) => x.werte));
  const B = 300, H = 104, U = 16, T = 12;
  const w = (B - 8) / g.length, n = props.reihen.length, bw = Math.min(14, (w - 16) / n);
  const y = (ct: number) => T + (H - T - U) * (1 - Math.max(0, ct) / max);
  const fmt = props.format ?? euro0;
  return (
    <svg className="balken-chart" viewBox={`0 0 ${B} ${H}`} role="img" aria-label={g.map((x) => `${x.label}: ${x.werte.map((v, i) => `${props.reihen[i].label} ${fmt(v)}`).join(', ')}`).join('; ')}>
      <line x1={0} x2={B} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--achse)' }} strokeWidth={1} />
      {g.map((x, i) => {
        const mitte = 4 + i * w + w / 2;
        return (
          <g key={x.label}>
            {x.werte.map((v, j) => {
              const h = y(0) - y(v);
              const x0 = mitte - (n * bw + (n - 1) * 2) / 2 + j * (bw + 2);
              return h > 0 ? <rect key={j} x={x0} y={y(v)} width={bw} height={h} rx={2} style={{ fill: props.reihen[j].farbe }}><title>{`${x.label} · ${props.reihen[j].label}: ${fmt(v)}`}</title></rect> : null;
            })}
            <text x={mitte} y={H - 3} textAnchor="middle" className="achse-text">{x.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Ring chart of shares (costs by type) with a legend.
export const PALETTE = ['var(--k1)', 'var(--k2)', 'var(--k3)', 'var(--k4)', 'var(--k5)', 'var(--k6)', 'var(--k7)', 'var(--k8)'];
export function Ringdiagramm(props: { teile: { label: string; ct: number }[]; mitte?: string }) {
  const summe = props.teile.reduce((s, t) => s + t.ct, 0);
  if (!summe) return <p className="hinweis klein">Noch keine Kosten gebucht.</p>;
  const r = 30, c = 40, u = 2 * Math.PI * r;
  let lauf = 0;
  return (
    <div className="ringdiagramm">
      <svg width={80} height={80} viewBox="0 0 80 80" role="img" aria-label={props.teile.map((t) => `${t.label} ${euro0(t.ct)}`).join(', ')}>
        <circle cx={c} cy={c} r={r} fill="none" style={{ stroke: 'var(--raster)' }} strokeWidth={10} />
        {props.teile.map((t, i) => {
          const l = u * t.ct / summe;
          const el = <circle key={i} cx={c} cy={c} r={r} fill="none" style={{ stroke: PALETTE[i % PALETTE.length] }} strokeWidth={10}
            strokeDasharray={`${Math.max(0, l - 1).toFixed(2)} ${u.toFixed(2)}`} strokeDashoffset={(-lauf).toFixed(2)} transform={`rotate(-90 ${c} ${c})`}><title>{`${t.label}: ${euro0(t.ct)}`}</title></circle>;
          lauf += l;
          return el;
        })}
        {props.mitte && <text x={c} y={c + 4} textAnchor="middle" className="ring-text">{props.mitte}</text>}
      </svg>
      <ul className="ring-legende">
        {props.teile.map((t, i) => <li key={t.label}><i style={{ background: PALETTE[i % PALETTE.length] }} /><span>{t.label}</span><b>{euro0(t.ct)}</b></li>)}
      </ul>
    </div>
  );
}

// Stacked bar of parts (arrears by age) with a legend below.
export function Stapel(props: { teile: { label: string; ct: number; farbe: string }[] }) {
  const summe = props.teile.reduce((s, t) => s + t.ct, 0);
  return (
    <>
      <div className="stapel-balken" role="img" aria-label={props.teile.map((t) => `${t.label} ${euro0(t.ct)}`).join(', ')}>
        {summe ? props.teile.filter((t) => t.ct > 0).map((t) => <span key={t.label} style={{ width: `${t.ct / summe * 100}%`, background: t.farbe }} title={`${t.label}: ${euro0(t.ct)}`} />)
          : <span style={{ width: '100%', background: 'var(--raster)' }} />}
      </div>
      <div className="legende klein stapel-legende">{props.teile.map((t) => <span key={t.label}><i style={{ background: t.farbe }} />{t.label}<b>{euro0(t.ct)}</b></span>)}</div>
    </>
  );
}

// Expected balance over the next days as a line; the lowest point is marked.
export function Vorschau(props: { punkte: { datum: string; ct: number }[]; tief: Row }) {
  const p = props.punkte;
  const [hover, setHover] = useState<number | null>(null);
  if (p.length < 2) return null;
  const B = 600, H = 132, L0 = 66, U = 18, T = 10;
  // The axis spans the expected values (with some room), so the low point is visible; zero only when it is reached.
  const werte = p.map((x) => x.ct);
  const hoch = Math.max(...werte), tief = Math.min(...werte);
  const rand = Math.max((hoch - tief) * 0.15, Math.abs(hoch) * 0.03, 10000);
  const max = hoch + rand, min = tief < rand ? Math.min(0, tief - rand) : tief - rand;
  const span = max - min || 1;
  const x = (i: number) => L0 + (B - L0 - 6) * i / (p.length - 1);
  const y = (ct: number) => T + (H - T - U) * (max - ct) / span;
  const linie = p.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(q.ct).toFixed(1)}`).join(' ');
  const ti = p.findIndex((q) => q.datum === props.tief.datum);
  const kurz = euro0;
  const monate = p.map((q, i) => [q, i] as const).filter(([q, i]) => q.datum.endsWith('-01') && i > 0);
  return (
    <div className="diagramm">
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label={`Erwarteter Kontostand bis ${datum(p[p.length - 1].datum)}, tiefster Stand ${euro0(props.tief.ct)} am ${datum(props.tief.datum)}`}
        onMouseLeave={() => setHover(null)} onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round(((e.clientX - r.left) / r.width * B - L0) / (B - L0 - 6) * (p.length - 1));
          setHover(i >= 0 && i < p.length ? i : null);
        }}>
        {[max, (max + min) / 2, min].map((v, i) => (
          <g key={i}><line x1={L0} x2={B} y1={y(v)} y2={y(v)} style={{ stroke: 'var(--raster)' }} strokeWidth={1} />
            <text x={L0 - 6} y={y(v) + 4} textAnchor="end" className="achse-text">{kurz(v)}</text></g>
        ))}
        {min < 0 && <line x1={L0} x2={B} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--rot)' }} strokeWidth={1} strokeDasharray="3 3" />}
        {monate.map(([q, i]) => <text key={q.datum} x={x(i)} y={H - 4} textAnchor="middle" className="achse-text">{MONATE[Number(q.datum.slice(5, 7)) - 1]}</text>)}
        <path d={linie} fill="none" style={{ stroke: 'var(--c1)' }} strokeWidth={1.8} strokeLinejoin="round" />
        {ti >= 0 && <circle cx={x(ti)} cy={y(p[ti].ct)} r={4} style={{ fill: 'var(--rot)', stroke: 'var(--panel)' }} strokeWidth={1.5} />}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - U} style={{ stroke: 'var(--achse)' }} strokeWidth={1} />}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${x(hover) / B * 100}%` }}><b>{datum(p[hover].datum)}</b><div>{euro0(p[hover].ct)}</div></div>
      )}
    </div>
  );
}

// A row of facts in a key figure tile.
export const KzListe = (props: { zeilen: [ReactNode, ReactNode, string?][] }) => (
  <ul className="kz-liste">{props.zeilen.map(([l, w, k], i) => <li key={i} className={k}><span>{l}</span><b>{w}</b></li>)}</ul>
);

export const Weiter = (props: { zu: Ziel; children: ReactNode }) => <L zu={props.zu} className="weiter">{props.children} →</L>;
