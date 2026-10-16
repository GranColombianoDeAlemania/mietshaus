// Photos and documents of an object, a unit or a project: thumbnails, drop zone, lightbox.
import { useEffect, useState } from 'react';
import { call, datum, type Row } from './api';
import { useLoad } from './useLoad';
import { DokumentDialog, dokUrl } from './views/Archiv';

const istBild = (datei: string) => /\.(png|jpe?g|gif|webp)$/i.test(datei);
const symbol = (d: Row) => (/\.pdf$/i.test(d.datei) ? '📄' : /\.(docx?|odt|txt)$/i.test(d.datei) ? '📝' : /\.(xlsx?|ods|csv)$/i.test(d.datei) ? '📊' : '📎');

export function Galerie(props: { filter: { objekt_id?: number; einheit_id?: number; projekt_id?: number; person_id?: number };
  hinweis?: string; ablage?: Record<string, unknown> }) {
  const [nurBilder, setNurBilder] = useState(false);
  const [liste, reload] = useLoad<Row[]>(() => call('galerie', { ...props.filter, nur_bilder: nurBilder }), [JSON.stringify(props.filter), nurBilder]);
  const [zone, setZone] = useState(false);
  const [gross, setGross] = useState<number | null>(null);
  const [meta, setMeta] = useState<Row | null>(null);
  const bilder = (liste ?? []).filter((d) => istBild(d.datei));

  // Files added here are filed directly with this object/unit/project; images are typed as photos.
  async function hinzufuegen(files?: FileList) {
    const ziel = props.ablage ?? props.filter;
    const opt = { ...ziel, status: 'abgelegt' };
    const r = files ? await window.hv.importieren(files, opt) : await window.hv.dateienImportieren(opt);
    for (const x of r) if (/\.(png|jpe?g|gif|webp|heic|heif)$/i.test(x.name)) await call('dokumentSpeichern', { id: x.id, typ: 'Foto', ...ziel });
    reload();
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (gross == null) return;
      if (e.key === 'ArrowRight') setGross((gross + 1) % bilder.length);
      if (e.key === 'ArrowLeft') setGross((gross - 1 + bilder.length) % bilder.length);
      if (e.key === 'Escape') setGross(null);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [gross, bilder.length]);

  return (
    <div>
      <div className={`ablagezone${zone ? ' aktiv' : ''}`}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setZone(true); window.dispatchEvent(new Event('hv-ziehen-aus')); }}
        onDragLeave={() => setZone(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setZone(false); if (e.dataTransfer.files.length) hinzufuegen(e.dataTransfer.files); }}>
        Fotos und Dateien hierher ziehen – sie werden direkt hier abgelegt{props.hinweis ? ` (${props.hinweis})` : ''}. &nbsp;
        <button onClick={() => hinzufuegen()}>Dateien wählen…</button>
        <label className="check" style={{ display: 'inline-flex', marginLeft: 12 }}><input type="checkbox" checked={nurBilder} onChange={(e) => setNurBilder(e.target.checked)} /> nur Fotos</label>
      </div>
      {liste && !liste.length && <p className="hinweis">Noch nichts abgelegt.</p>}
      <div className="galerie">
        {liste?.map((d) => (
          <div key={d.id} className="kachelbild" title={d.name} draggable data-ziel={`dokument:${d.id}`}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-hv-dokument', String(d.id)); e.dataTransfer.effectAllowed = 'link'; }}
            onClick={() => (istBild(d.datei) ? setGross(bilder.findIndex((b) => b.id === d.id)) : setMeta(d))}>
            <div className="bild" style={istBild(d.datei) ? { backgroundImage: `url("${dokUrl(d.datei)}")` } : undefined}>{istBild(d.datei) ? '' : symbol(d)}</div>
            <div className="titel">{d.titel}<span className="klein">{[d.einheit, d.typ, datum(d.datum ?? d.erfasst)].filter(Boolean).join(' · ')}</span></div>
          </div>
        ))}
      </div>
      {gross != null && bilder[gross] && (
        <div className="lightbox" onClick={(e) => e.target === e.currentTarget && setGross(null)}>
          <img src={dokUrl(bilder[gross].datei)} />
          <div className="leiste">
            <button onClick={() => setGross((gross - 1 + bilder.length) % bilder.length)}>‹</button>
            <span>{bilder[gross].titel} · {gross + 1} / {bilder.length}</span>
            <button onClick={() => setGross((gross + 1) % bilder.length)}>›</button>
            <button onClick={() => { setMeta(bilder[gross]); setGross(null); }}>Angaben bearbeiten</button>
            {props.filter.objekt_id && !props.filter.einheit_id && (
              <button onClick={async () => { await call('save', 'objekte', { id: props.filter.objekt_id, titelbild_id: bilder[gross].id }); window.dispatchEvent(new Event('hv-daten')); }}>Als Titelbild</button>
            )}
            <button onClick={() => setGross(null)}>Schließen</button>
          </div>
        </div>
      )}
      {meta && <DokumentDialog id={meta.id} datei={meta.datei} onClose={() => { setMeta(null); reload(); }} />}
    </div>
  );
}
