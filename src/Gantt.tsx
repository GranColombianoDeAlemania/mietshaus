// Gantt chart: one row per task, time axis by month (or week for short plans), today line, progress fill,
// dependency arrows and milestones. Hover shows the details; click opens the row.
import { useState } from 'react';
import { datum, heute as heuteIso } from './api';

export type GanttZeile = {
  id: number | string;
  titel: string;
  beginn: string;
  ende: string;
  gruppe?: string;
  fortschritt?: number;
  meilenstein?: boolean;
  erledigt?: boolean;
  art?: 'aufgabe' | 'frist' | 'termin' | 'projekt';
  nach?: number | string | null;
  info?: string;
};

// Categorical slots 1–3 of the validated reference palette; never status colours.
const FARBE: Record<string, string> = { aufgabe: 'var(--c1)', projekt: 'var(--c1)', frist: 'var(--c2)', termin: 'var(--c3)' };
const MONATE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const tag = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 864e5);
const iso = (t: number) => new Date(t * 864e5).toISOString().slice(0, 10);

export function Gantt(props: { zeilen: GanttZeile[]; onKlick?: (z: GanttZeile) => void; von?: string; bis?: string }) {
  const [hover, setHover] = useState<GanttZeile | null>(null);
  const [maus, setMaus] = useState({ x: 0, y: 0 });
  const z = props.zeilen;
  if (!z.length) return <p className="hinweis">Noch keine Einträge mit Datum.</p>;

  const start = props.von ? tag(props.von) : Math.min(...z.map((r) => tag(r.beginn))) - 3;
  const ende = props.bis ? tag(props.bis) : Math.max(...z.map((r) => tag(r.ende))) + 4;
  const tage = Math.max(14, ende - start + 1);
  const LINKS = 230, ZEILE = 30, KOPF = 34, B = 1000;
  const breite = B - LINKS;
  const x = (t: number) => LINKS + ((t - start) / tage) * breite;

  // Rows grouped under their group heading.
  const gruppen: (GanttZeile | string)[] = [];
  let letzte: string | undefined;
  for (const r of z) {
    if (r.gruppe && r.gruppe !== letzte) { gruppen.push(r.gruppe); letzte = r.gruppe; }
    gruppen.push(r);
  }
  const H = KOPF + gruppen.length * ZEILE + 6;
  const zeileY = new Map<GanttZeile['id'], number>();
  gruppen.forEach((g, i) => { if (typeof g !== 'string') zeileY.set(g.id, KOPF + i * ZEILE + ZEILE / 2); });

  // Month ticks, or week ticks for plans shorter than ~10 weeks.
  const ticks: { t: number; label: string }[] = [];
  if (tage > 70) {
    const d = new Date(iso(start) + 'T00:00:00Z');
    d.setUTCDate(1);
    for (; tag(d.toISOString().slice(0, 10)) <= start + tage; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const t = tag(d.toISOString().slice(0, 10));
      if (t >= start) ticks.push({ t, label: `${MONATE[d.getUTCMonth()]}${d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : ''}` });
    }
  } else {
    const ersterMontag = start + ((8 - new Date(start * 864e5).getUTCDay()) % 7);
    for (let t = ersterMontag; t <= start + tage; t += 7) ticks.push({ t, label: datum(iso(t)).slice(0, 6) });
  }
  const heute = tag(heuteIso());

  return (
    <div className="gantt" onMouseLeave={() => setHover(null)}>
      <div className="legende">
        <span><i style={{ background: FARBE.aufgabe }} /> Aufgabe / Projekt (dunkel = erledigter Anteil)</span>
        {z.some((r) => r.art === 'frist') && <span><i style={{ background: FARBE.frist }} /> Frist / Zeitfenster</span>}
        {z.some((r) => r.art === 'termin' || r.meilenstein) && <span><i style={{ background: FARBE.termin, transform: 'rotate(45deg)' }} /> Termin / Meilenstein</span>}
      </div>
      <svg viewBox={`0 0 ${B} ${H}`} role="img" aria-label="Zeitplan"
        onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMaus({ x: e.clientX - r.left, y: e.clientY - r.top }); }}>
        {ticks.map((k) => (
          <g key={k.t}>
            <line x1={x(k.t)} x2={x(k.t)} y1={KOPF - 6} y2={H} style={{ stroke: 'var(--raster)' }} />
            <text x={x(k.t) + 4} y={KOPF - 12} fontSize={11} style={{ fill: 'var(--achsentext)' }}>{k.label}</text>
          </g>
        ))}
        {gruppen.map((g, i) => {
          const y = KOPF + i * ZEILE;
          if (typeof g === 'string') return <text key={'g' + i} x={8} y={y + 20} fontSize={12} fontWeight={700} style={{ fill: 'var(--muted)' }}>{g}</text>;
          const farbe = FARBE[g.art ?? (g.meilenstein ? 'termin' : 'aufgabe')];
          const x0 = x(tag(g.beginn)), x1 = x(tag(g.ende) + 1);
          const mitte = y + ZEILE / 2;
          const punkt = g.meilenstein || g.art === 'termin' || g.beginn === g.ende && g.art !== 'aufgabe';
          const fortschritt = g.erledigt ? 100 : g.fortschritt ?? 0;
          return (
            <g key={g.id} className={props.onKlick ? 'klickbar' : ''} onMouseEnter={() => setHover(g)} onClick={() => props.onKlick?.(g)}>
              <rect x={0} y={y} width={B} height={ZEILE} style={{ fill: hover?.id === g.id ? 'color-mix(in srgb, var(--accent-soft) 50%, transparent)' : 'transparent' }} />
              <text x={16} y={mitte + 4} fontSize={12.5} style={{ fill: g.erledigt ? 'var(--muted)' : 'var(--ink)' }}>
                {g.erledigt ? '✓ ' : ''}{g.titel.length > 30 ? g.titel.slice(0, 29) + '…' : g.titel}
              </text>
              {punkt ? (
                <rect x={x0 - 6} y={mitte - 6} width={12} height={12} transform={`rotate(45 ${x0} ${mitte})`} style={{ fill: farbe }} opacity={g.erledigt ? 0.45 : 1} />
              ) : (
                <>
                  <rect x={x0} y={mitte - 8} width={Math.max(3, x1 - x0)} height={16} rx={4} style={{ fill: farbe }} opacity={0.28} />
                  {fortschritt > 0 && <rect x={x0} y={mitte - 8} width={Math.max(3, (x1 - x0) * fortschritt / 100)} height={16} rx={4} style={{ fill: farbe }} />}
                </>
              )}
            </g>
          );
        })}
        {/* Dependency arrows: from the end of the predecessor to the start of the follower. */}
        {z.filter((r) => r.nach != null && zeileY.has(r.nach!)).map((r) => {
          const vor = z.find((v) => v.id === r.nach)!;
          const xa = x(tag(vor.ende) + 1), ya = zeileY.get(vor.id)!, xb = x(tag(r.beginn)), yb = zeileY.get(r.id)!;
          const xm = Math.max(xa + 6, Math.min(xb - 6, xa + 10));
          return <path key={'p' + r.id} d={`M${xa},${ya} H${xm} V${yb} H${xb - 2}`} fill="none" style={{ stroke: 'var(--achsentext)' }} strokeWidth={1.2} markerEnd="url(#pfeil)" />;
        })}
        <defs><marker id="pfeil" viewBox="0 0 6 6" refX={5} refY={3} markerWidth={6} markerHeight={6} orient="auto"><path d="M0,0 L6,3 L0,6 Z" style={{ fill: 'var(--achsentext)' }} /></marker></defs>
        {heute >= start && heute <= start + tage && (
          <g>
            <line x1={x(heute)} x2={x(heute)} y1={KOPF - 6} y2={H} stroke="#d03b3b" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={x(heute) + 3} y={H - 4} fontSize={10.5} fill="#d03b3b">heute</text>
          </g>
        )}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(maus.x + 14, 700), top: maus.y + 14, transform: 'none' }}>
          <b>{hover.titel}</b>
          <div>{datum(hover.beginn)}{hover.ende !== hover.beginn ? ` – ${datum(hover.ende)}` : ''}</div>
          {hover.fortschritt != null && !hover.meilenstein && <div>Fortschritt {hover.fortschritt} %</div>}
          {hover.erledigt && <div>erledigt</div>}
          {hover.info && <div className="klein">{hover.info}</div>}
        </div>
      )}
    </div>
  );
}
