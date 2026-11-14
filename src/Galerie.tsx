// Photos, videos and documents of an object, a unit or a project: thumbnails, drop zone, viewer. kompakt: one row of
// small thumbnails with a camera and a paperclip tile at its end (a task, an article) – files can be dropped on it too.
import { useEffect, useRef, useState } from 'react';
import * as RD from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Paperclip, Play, X } from 'lucide-react';
import { call, datum, type Row } from './api';
import { useLoad } from './useLoad';
import { DokumentDialog, dokUrl } from './views/Archiv';
import { FotoKnopf } from './Foto';
import { dateiSymbol } from './icons';

export const istBild = (datei: string) => /\.(png|jpe?g|gif|webp)$/i.test(datei);
export const istVideo = (datei: string) => /\.(mp4|m4v|mov|webm)$/i.test(datei);
const istMedium = (datei: string) => istBild(datei) || istVideo(datei);
const Symbol = (props: { datei: string }) => { const S = dateiSymbol(props.datei); return <S size={34} strokeWidth={1.4} aria-hidden="true" />; };

// Thumbnail content: a photo as background (set by the caller), a video as its first frame with a play mark.
function Vorschau(props: { datei: string }) {
  if (istBild(props.datei)) return null;
  if (istVideo(props.datei)) return <>
    <video className="vorschau-video" src={`${dokUrl(props.datei)}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
    <span className="vorschau-play" aria-hidden="true"><Play size={14} fill="currentColor" /></span>
  </>;
  return <Symbol datei={props.datei} />;
}
const hintergrund = (datei: string) => (istBild(datei) ? { backgroundImage: `url("${dokUrl(datei)}")` } : undefined);

export function Galerie(props: { filter: { objekt_id?: number; einheit_id?: number; projekt_id?: number; person_id?: number; vorgang_id?: number };
  hinweis?: string; ablage?: Record<string, unknown>; kompakt?: boolean; onGeaendert?: () => void }) {
  const [nurBilder, setNurBilder] = useState(false);
  const [liste, reload] = useLoad<Row[]>(() => call('galerie', { ...props.filter, nur_bilder: nurBilder }), [JSON.stringify(props.filter), nurBilder]);
  const [zone, setZone] = useState(false);
  const [gross, setGross] = useState<number | null>(null);
  const [meta, setMeta] = useState<Row | null>(null);
  const medien = (liste ?? []).filter((d) => istMedium(d.datei));
  const oeffnen = (d: Row) => (istMedium(d.datei) ? setGross(medien.findIndex((b) => b.id === d.id)) : setMeta(d));
  const fertig = () => { reload(); props.onGeaendert?.(); };

  // Files added here are filed directly with this object/unit/project; images and videos are typed as photos.
  async function hinzufuegen(files?: FileList) {
    const ziel = props.ablage ?? props.filter;
    const opt = { ...ziel, status: 'abgelegt' };
    const r = files ? await window.hv.importieren(files, opt) : await window.hv.dateienImportieren(opt);
    for (const x of r) if (/\.(png|jpe?g|gif|webp|heic|heif|mp4|m4v|mov|webm)$/i.test(x.name)) await call('dokumentSpeichern', { id: x.id, typ: 'Foto', ...ziel });
    fertig();
  }

  const ziehen = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setZone(true); window.dispatchEvent(new Event('hv-ziehen-aus')); },
    onDragLeave: () => setZone(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setZone(false); if (e.dataTransfer.files.length) hinzufuegen(e.dataTransfer.files); },
  };
  const titelbild = props.filter.objekt_id && !props.filter.einheit_id
    ? async (d: Row) => { await call('save', 'objekte', { id: props.filter.objekt_id, titelbild_id: d.id }); window.dispatchEvent(new Event('hv-daten')); }
    : undefined;
  return (
    <div>
      {props.kompakt ? (
        <div className={`fotostreifen${zone ? ' aktiv' : ''}`} {...ziehen}>
          {liste?.map((d) => (
            <button key={d.id} type="button" className="fotostreifen-bild" title={d.titel}
              aria-label={istVideo(d.datei) ? `Video „${d.titel}“ ansehen` : istBild(d.datei) ? `Foto „${d.titel}“ ansehen` : `„${d.titel}“ öffnen`}
              style={hintergrund(d.datei)} onClick={() => oeffnen(d)}><Vorschau datei={d.datei} /></button>
          ))}
          <FotoKnopf opt={props.ablage ?? props.filter} onFertig={fertig} klein video />
          <button type="button" className="icon" title="Datei anhängen" aria-label="Datei anhängen" onClick={() => hinzufuegen()}><Paperclip size={15} /></button>
        </div>
      ) : <>
      <div className={`ablagezone${zone ? ' aktiv' : ''}`} {...ziehen}>
        Fotos, Videos und Dateien hierher ziehen – sie werden direkt hier abgelegt{props.hinweis ? ` (${props.hinweis})` : ''}. &nbsp;
        <button onClick={() => hinzufuegen()}>Dateien wählen…</button> <FotoKnopf opt={props.ablage ?? props.filter} onFertig={fertig} video />
        <label className="check" style={{ display: 'inline-flex', marginLeft: 12 }}><input type="checkbox" checked={nurBilder} onChange={(e) => setNurBilder(e.target.checked)} /> nur Fotos und Videos</label>
      </div>
      {liste && !liste.length && <p className="hinweis">Noch nichts abgelegt.</p>}
      <div className="galerie">
        {liste?.map((d) => (
          <div key={d.id} className="kachelbild" title={d.name} draggable data-ziel={`dokument:${d.id}`}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-hv-dokument', String(d.id)); e.dataTransfer.effectAllowed = 'link'; }}
            onClick={() => oeffnen(d)}>
            <div className="bild" style={hintergrund(d.datei)}><Vorschau datei={d.datei} /></div>
            <div className="titel">{d.titel}<span className="klein">{[d.einheit, d.typ, datum(d.datum ?? d.erfasst)].filter(Boolean).join(' · ')}</span></div>
          </div>
        ))}
      </div>
      </>}
      {gross != null && medien[gross] && (
        <Medienansicht medien={medien} index={gross} onIndex={setGross} onClose={() => setGross(null)}
          onAngaben={(d) => { setMeta(d); setGross(null); }} onTitelbild={titelbild} />
      )}
      {meta && <DokumentDialog id={meta.id} datei={meta.datei} onClose={() => { setMeta(null); fertig(); }} />}
    </div>
  );
}

// Full-screen viewer for photos and videos: arrows at the sides, swipe on the phone, arrow keys, thumbnails below.
export function Medienansicht(props: { medien: Row[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  onAngaben?: (d: Row) => void; onTitelbild?: (d: Row) => void }) {
  const { medien, index } = props;
  const n = medien.length;
  const d = medien[index];
  const weiter = (schritt: number) => props.onIndex((index + schritt + n) % n);
  const schliessen = useRef<HTMLButtonElement>(null);
  const streifen = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [titelGesetzt, setTitelGesetzt] = useState<number | null>(null);

  // Escape is handled by the window itself (Radix), only the arrows here.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'VIDEO') return;
      if (e.key === 'ArrowRight' && n > 1) { e.preventDefault(); weiter(1); }
      if (e.key === 'ArrowLeft' && n > 1) { e.preventDefault(); weiter(-1); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  // Keep the current thumbnail in view.
  useEffect(() => { streifen.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [index]);

  // A horizontal swipe of at least 50 px changes the picture; a swipe on a video's controls (its lowest 56 px) scrubs instead.
  const runter = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const ziel = e.target as HTMLElement;
    if (ziel.tagName === 'VIDEO' && e.clientY > ziel.getBoundingClientRect().bottom - 56) return;
    start.current = { x: e.clientX, y: e.clientY };
  };
  const hoch = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || n < 2) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) weiter(dx < 0 ? 1 : -1);
  };

  // A window of its own (Radix) on the page itself: opened from a task window it stacks on top of it – a plain layer
  // would be covered by the task window, which also blocks every click beside it.
  return (
    <RD.Root open onOpenChange={(o) => { if (!o) props.onClose(); }}>
    <RD.Portal>
    <RD.Content asChild aria-describedby={undefined} onOpenAutoFocus={(e) => { e.preventDefault(); schliessen.current?.focus(); }}>
    <div className="lightbox">
      <div className="lightbox-kopf">
        <RD.Title asChild><span className="lightbox-titel"><b>{index + 1} / {n}</b> {d.titel}</span></RD.Title>
        <span className="lightbox-aktionen">
          {props.onAngaben && <button type="button" onClick={() => props.onAngaben!(d)}>Angaben</button>}
          {props.onTitelbild && istBild(d.datei) && (
            <button type="button" onClick={async () => { await props.onTitelbild!(d); setTitelGesetzt(d.id); }}>{titelGesetzt === d.id ? 'Ist Titelbild ✓' : 'Als Titelbild'}</button>
          )}
          <button type="button" ref={schliessen} className="lightbox-zu" aria-label="Schließen" title="Schließen (Esc)" onClick={props.onClose}><X size={20} /></button>
        </span>
      </div>
      <div className="lightbox-buehne" onPointerDown={runter} onPointerUp={hoch} onPointerCancel={() => { start.current = null; }}
        onClick={(e) => e.target === e.currentTarget && props.onClose()}>
        {istVideo(d.datei)
          ? <video key={d.id} src={dokUrl(d.datei)} controls playsInline autoPlay preload="metadata" />
          : <img key={d.id} src={dokUrl(d.datei)} alt={d.titel} draggable={false} />}
        {n > 1 && <>
          <button type="button" className="lightbox-pfeil links" aria-label="Vorheriges" title="Vorheriges (←)" onClick={() => weiter(-1)}><ChevronLeft size={28} /></button>
          <button type="button" className="lightbox-pfeil rechts" aria-label="Nächstes" title="Nächstes (→)" onClick={() => weiter(1)}><ChevronRight size={28} /></button>
        </>}
      </div>
      {n > 1 && (
        <div className="lightbox-streifen" ref={streifen}>
          {medien.map((m, i) => (
            <button key={m.id} type="button" className="fotostreifen-bild" aria-current={i === index} aria-label={`${istVideo(m.datei) ? 'Video' : 'Foto'} ${i + 1}: ${m.titel}`}
              style={hintergrund(m.datei)} onClick={() => props.onIndex(i)}><Vorschau datei={m.datei} /></button>
          ))}
        </div>
      )}
    </div>
    </RD.Content>
    </RD.Portal>
    </RD.Root>
  );
}
