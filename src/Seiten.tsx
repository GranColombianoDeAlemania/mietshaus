// Several pages, one document: a bill over two pages, photographed or chosen as files, becomes one PDF – one entry in
// the inbox, one booking. The page window works like a scanner app: every photo is cut to the sheet and evened out,
// pages can be turned, reordered, removed, their corners moved by hand. Scanned PDFs (Files app → "Scan Documents")
// join as pages too.
import { useEffect, useRef, useState } from 'react';
import * as I from 'lucide-react';
import { Fenster, FensterTitel } from './ui';
import { frage, hinweis } from './frage';
import { anfrage, dateienWaehlen } from './bruecke';
import { handy } from './Foto';
import { alsJpeg, aufbereiten, bildLaden, drehen, eckenFinden, entzerren, verkleinern, type Filter, type Punkt } from './scan';
import { pdfAusJpegs, pdfSeiten } from './pdfbau';

type Seite = {
  key: string;
  quelle: Blob; // the photo (upright through its EXIF orientation) or a PDF page as JPEG
  foto: boolean; // photos are cut and evened out; PDF pages only turned
  breiteQ: number; hoeheQ: number; // size of the source picture
  ecken: Punkt[] | null; // where the sheet is in the source (found or moved by hand)
  zuschnitt: boolean;
  filter: Filter;
  drehung: number;
  ergebnis?: Blob; breite?: number; hoehe?: number; url?: string;
  arbeitet?: boolean;
};

const BILD = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;
const istPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const istBild = (f: File) => f.type.startsWith('image/') || BILD.test(f.name);
export const seitenTauglich = (f: File) => istPdf(f) || istBild(f);

let zaehler = 0;
const neuerKey = () => `s${++zaehler}`;
// HEIC outside Safari: the server turns it into a JPEG.
const umwandeln = async (f: Blob) => (await anfrage('/api/jpeg', { roh: f, typ: 'application/octet-stream' })).blob();

class ERechnung extends Error {}

// The source files as pages: photos as they are, PDFs page by page. An e-invoice PDF is refused (its data would be lost).
async function seitenAus(dateien: File[]): Promise<Seite[]> {
  const out: Seite[] = [];
  for (const f of dateien) {
    if (istPdf(f)) {
      const r = await pdfSeiten(f);
      if (r.eRechnung) throw new ERechnung(`„${f.name}“ ist eine E-Rechnung. Ihre Daten gingen beim Zusammenfügen verloren – bitte einzeln hochladen.`);
      for (const c of r.seiten) out.push({ key: neuerKey(), quelle: await alsJpeg(c, 0.88), foto: false, breiteQ: c.width, hoeheQ: c.height, ecken: null, zuschnitt: false, filter: 'original', drehung: 0 });
    } else {
      const b = await bildLaden(f, umwandeln);
      // A browser that could not read the file got a JPEG from the server: that becomes the source.
      const quelle = f.type === 'image/heic' || /\.hei[cf]$/i.test(f.name) ? await alsJpeg(verkleinern(b, 3000), 0.9) : f;
      const ecken = eckenFinden(b);
      out.push({ key: neuerKey(), quelle, foto: true, breiteQ: b.width, hoeheQ: b.height, ecken, zuschnitt: !!ecken, filter: 'farbe', drehung: 0 });
      b.close();
    }
  }
  return out;
}

// The finished page: cut, evened out, turned – as a JPEG.
async function bauen(s: Seite): Promise<Seite> {
  const b = await bildLaden(s.quelle, umwandeln);
  try {
    let c = s.foto && s.zuschnitt && s.ecken ? entzerren(b, s.ecken) : verkleinern(b);
    if (s.foto) c = aufbereiten(c, s.filter);
    c = drehen(c, s.drehung);
    const ergebnis = await alsJpeg(c, s.filter === 'grau' ? 0.78 : 0.82);
    if (s.url) URL.revokeObjectURL(s.url);
    return { ...s, ergebnis, breite: c.width, hoehe: c.height, url: URL.createObjectURL(ergebnis), arbeitet: false };
  } finally { b.close(); }
}

async function alsPdf(seiten: Seite[], name: string): Promise<File> {
  const fertig = [];
  for (const s of seiten) {
    const x = s.ergebnis ? s : await bauen(s);
    fertig.push({ jpeg: new Uint8Array(await x.ergebnis!.arrayBuffer()), breite: x.breite!, hoehe: x.hoehe! });
  }
  const datei = `${name.replace(/\.pdf$/i, '')}${seiten.length > 1 ? ` (${seiten.length} Seiten)` : ''}.pdf`;
  return new File([pdfAusJpegs(fertig)], datei, { type: 'application/pdf' });
}

const heute = () => new Date().toLocaleDateString('de-DE');
// Photos from a phone are called image.jpg or IMG_1234: the document is named by its date instead (a single PDF keeps its name).
const nameVon = (dateien: File[], vorgabe?: string) => vorgabe ?? (dateien.length === 1 && istPdf(dateien[0]) ? dateien[0].name.replace(/\.[^.]+$/, '') : `Dokument ${heute()}`);

// ---------- the page window, awaited from anywhere like frage() ----------
export type SeitenOpt = { dateien?: File[]; titel?: string; name?: string; einzeln?: boolean; knopf?: string };
export type SeitenErgebnis = { art: 'eins'; datei: File } | { art: 'einzeln'; dateien: File[] } | null;
type Offen = SeitenOpt & { fertig: (r: SeitenErgebnis) => void };
let zeigen: ((o: Offen | null) => void) | null = null;
export const seitenBearbeiten = (o: SeitenOpt) => new Promise<SeitenErgebnis>((fertig) => (zeigen ? zeigen({ ...o, fertig }) : fertig(null)));

export function SeitenHost() {
  const [o, setO] = useState<Offen | null>(null);
  useEffect(() => { zeigen = setO; return () => { zeigen = null; }; }, []);
  if (!o) return null;
  return <SeitenFenster {...o} fertig={(r) => { setO(null); o.fertig(r); }} />;
}

// Several files chosen or dropped for the inbox: one document of several pages, or each on its own?
// Returns the files to upload (one PDF, or the files as they were), or null when cancelled.
export async function mehrseitig(dateien: File[], opt: { name?: string } = {}): Promise<File[] | null> {
  if (dateien.length < 2 || !dateien.every(seitenTauglich)) return dateien;
  const n = dateien.length;
  const wahl = await frage({
    titel: `${n} Dateien`,
    text: <p>Gehören die Dateien zu <b>einem</b> Dokument, zum Beispiel einer Rechnung über mehrere Seiten? Dann werden sie zu einer PDF zusammengefügt und nur einmal gebucht.</p>,
    optionen: [{ id: 'einzeln', label: `${n} einzelne Dokumente` }, { id: 'ansehen', label: 'Seiten ansehen …' }, { id: 'eins', label: `Ein Dokument (${n} Seiten)`, primary: true }],
  });
  if (!wahl) return null;
  if (wahl === 'einzeln') return dateien;
  const name = nameVon(dateien, opt.name);
  if (wahl === 'ansehen') {
    const r = await seitenBearbeiten({ dateien, name, einzeln: true });
    return !r ? null : r.art === 'eins' ? [r.datei] : r.dateien;
  }
  try {
    // Straight together: the pages as they are, only upright and not larger than needed.
    const seiten = (await seitenAus(dateien)).map((s) => ({ ...s, zuschnitt: false, filter: 'original' as Filter }));
    return [await alsPdf(seiten, name)];
  } catch (e) {
    if (e instanceof ERechnung) { await hinweis(e.message); return null; }
    throw e;
  }
}

function SeitenFenster(props: Offen) {
  const [seiten, setSeiten] = useState<Seite[]>([]);
  const [laedt, setLaedt] = useState(0);
  const [ecken, setEcken] = useState<string | null>(null);
  const [fertigt, setFertigt] = useState(false);
  const [quellen, setQuellen] = useState<File[]>([]);
  const geaendert = useRef(false);

  const hinzufuegen = async (dateien: File[]) => {
    const taugen = dateien.filter(seitenTauglich);
    if (taugen.length < dateien.length) await hinweis('Nur Fotos, Bilder und PDF-Dateien lassen sich als Seiten verwenden.');
    if (!taugen.length) return;
    setQuellen((q) => [...q, ...taugen]);
    setLaedt((n) => n + taugen.length);
    try {
      for (const f of taugen) {
        let neu: Seite[];
        try { neu = await seitenAus([f]); } catch (e) { await hinweis(e instanceof Error ? e.message : String(e)); continue; }
        neu = neu.map((s) => ({ ...s, arbeitet: true }));
        setSeiten((a) => [...a, ...neu]);
        for (const s of neu) { const x = await bauen(s); setSeiten((a) => a.map((y) => (y.key === x.key ? x : y))); }
        setLaedt((n) => n - 1);
      }
    } finally { setLaedt(0); }
  };
  useEffect(() => { if (props.dateien?.length) hinzufuegen(props.dateien); }, []);
  useEffect(() => () => { seiten.forEach((s) => s.url && URL.revokeObjectURL(s.url)); }, []);

  const aendern = async (key: string, f: (s: Seite) => Partial<Seite>) => {
    geaendert.current = true;
    const s = seiten.find((x) => x.key === key);
    if (!s) return;
    const neu = { ...s, ...f(s), arbeitet: true };
    setSeiten((a) => a.map((x) => (x.key === key ? neu : x)));
    const x = await bauen(neu);
    setSeiten((a) => a.map((y) => (y.key === key ? x : y)));
  };
  const schieben = (i: number, um: number) => {
    geaendert.current = true;
    setSeiten((a) => { const b = [...a]; const [x] = b.splice(i, 1); b.splice(Math.max(0, Math.min(b.length, i + um)), 0, x); return b; });
  };
  const entfernen = (key: string) => { geaendert.current = true; setSeiten((a) => a.filter((x) => x.key !== key)); };

  const fotografieren = async () => hinzufuegen(await dateienWaehlen({ kamera: true }));
  const waehlen = async () => hinzufuegen(await dateienWaehlen({ mehrere: true, endungen: ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'] }));
  const mediathek = async () => hinzufuegen(await dateienWaehlen({ medien: true, mehrere: true }));

  const name = props.name ?? nameVon(quellen);
  const fertig = async () => {
    if (!seiten.length) return;
    setFertigt(true);
    try {
      // A single PDF taken as it was stays the original file (its text layer and quality are kept).
      const pdf = quellen.length === 1 && istPdf(quellen[0]) ? quellen[0] : null;
      if (pdf && !geaendert.current && seiten.every((s) => !s.foto && !s.drehung)) return props.fertig({ art: 'eins', datei: pdf });
      props.fertig({ art: 'eins', datei: await alsPdf(seiten, name) });
    } catch (e) { setFertigt(false); await hinweis(e instanceof Error ? e.message : String(e)); }
  };
  const bearbeitet = seiten.find((s) => s.key === ecken);
  const n = seiten.length;
  const beschaeftigt = laedt > 0 || seiten.some((s) => s.arbeitet) || fertigt;

  return (
    <Fenster onClose={() => props.fertig(null)}>
      <div className="dialog bogen-dialog">
        <FensterTitel>{props.titel ?? 'Seiten eines Dokuments'}</FensterTitel>
        {bearbeitet ? (
          <EckenAnpassen seite={bearbeitet} onFertig={(e) => { const k = bearbeitet.key; setEcken(null); if (e !== undefined) aendern(k, () => (e ? { ecken: e, zuschnitt: true } : { zuschnitt: false })); }} />
        ) : (
          <>
            <p className="hinweis klein">Jedes Foto wird auf das Blatt zugeschnitten und aufgehellt. Tippe auf eine Seite, um die Ecken selbst zu setzen.</p>
            <ol className="bogen-liste" aria-label="Seiten">
              {seiten.map((s, i) => (
                <li key={s.key} className="bogen-kachel">
                  <button type="button" className="bogen-bild" disabled={!s.foto || s.arbeitet} onClick={() => setEcken(s.key)}
                    aria-label={s.foto ? `Seite ${i + 1}: Ecken anpassen` : `Seite ${i + 1}`} title={s.foto ? 'Ecken anpassen' : undefined}>
                    {s.url ? <img src={s.url} alt="" /> : <span className="bogen-laedt">Lädt …</span>}
                    {s.arbeitet && s.url && <span className="bogen-laedt">…</span>}
                  </button>
                  <div className="bogen-nr"><b>Seite {i + 1}</b>{s.foto && !s.zuschnitt && <span className="klein hinweis"> · ganzes Foto</span>}</div>
                  <div className="bogen-knoepfe">
                    <button type="button" className="icon" title="Nach vorn" aria-label={`Seite ${i + 1} nach vorn`} disabled={!i} onClick={() => schieben(i, -1)}><I.ChevronLeft size={16} /></button>
                    <button type="button" className="icon" title="Nach hinten" aria-label={`Seite ${i + 1} nach hinten`} disabled={i === n - 1} onClick={() => schieben(i, 1)}><I.ChevronRight size={16} /></button>
                    <button type="button" className="icon" title="Drehen" aria-label={`Seite ${i + 1} drehen`} disabled={s.arbeitet} onClick={() => aendern(s.key, (x) => ({ drehung: (x.drehung + 1) % 4 }))}><I.RotateCw size={16} /></button>
                    {s.foto && <select aria-label={`Seite ${i + 1}: Farbe`} value={s.filter} disabled={s.arbeitet} onChange={(e) => aendern(s.key, () => ({ filter: e.target.value as Filter }))}>
                      <option value="farbe">Farbe</option><option value="grau">Grau</option><option value="original">Original</option>
                    </select>}
                    <button type="button" className="icon loeschen" title="Seite entfernen" aria-label={`Seite ${i + 1} entfernen`} onClick={() => entfernen(s.key)}><I.Trash2 size={16} /></button>
                  </div>
                </li>
              ))}
              {laedt > 0 && !seiten.some((s) => s.arbeitet) && <li className="bogen-kachel bogen-platz"><span className="bogen-laedt">Lädt …</span></li>}
            </ol>
            <div className="bogen-dazu">
              {handy() && <button type="button" className={n ? undefined : 'primary'} onClick={fotografieren}><I.Camera size={15} /> {n ? 'Nächste Seite fotografieren' : 'Seite fotografieren'}</button>}
              {handy() && <button type="button" onClick={mediathek}><I.Images size={15} /> Aus Fotos</button>}
              <button type="button" onClick={waehlen}><I.FileUp size={15} /> {handy() ? 'Datei oder Scan' : 'Dateien hinzufügen …'}</button>
            </div>
            {handy() && <p className="hinweis klein">Scannen mit dem iPhone: in der Dateien- oder Notizen-App „Dokumente scannen“, dann hier „Datei oder Scan“ wählen.
              Der Scan wird als eine oder mehrere Seiten übernommen.</p>}
            <div className="buttons">
              <button type="button" onClick={() => props.fertig(null)}>Abbrechen</button>
              <span className="spacer" />
              {props.einzeln && quellen.length > 1 && <button type="button" disabled={beschaeftigt} onClick={() => props.fertig({ art: 'einzeln', dateien: quellen })}>{quellen.length} einzelne Dokumente</button>}
              <button type="button" className="primary" disabled={!n || beschaeftigt} onClick={fertig}>
                {fertigt ? 'Wird erstellt …' : props.knopf ?? (n > 1 ? `Ein Dokument (${n} Seiten)` : 'Hochladen')}</button>
            </div>
          </>
        )}
      </div>
    </Fenster>
  );
}

// The source photo with four handles at the sheet's corners. Returns the corners, null for the whole photo, undefined
// when cancelled.
function EckenAnpassen(props: { seite: Seite; onFertig: (e: Punkt[] | null | undefined) => void }) {
  const s = props.seite;
  const rand = (f: number) => [{ x: s.breiteQ * f, y: s.hoeheQ * f }, { x: s.breiteQ * (1 - f), y: s.hoeheQ * f }, { x: s.breiteQ * (1 - f), y: s.hoeheQ * (1 - f) }, { x: s.breiteQ * f, y: s.hoeheQ * (1 - f) }];
  const [e, setE] = useState<Punkt[]>(s.ecken ?? rand(0.06));
  const [url] = useState(() => URL.createObjectURL(s.quelle));
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const svg = useRef<SVGSVGElement>(null);
  const zieht = useRef<number | null>(null);
  const punkt = (ev: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.min(s.breiteQ, Math.max(0, ((ev.clientX - r.left) / r.width) * s.breiteQ)), y: Math.min(s.hoeheQ, Math.max(0, ((ev.clientY - r.top) / r.height) * s.hoeheQ)) };
  };
  const griff = Math.max(s.breiteQ, s.hoeheQ) / 26;
  const erkennen = async () => {
    const b = await bildLaden(s.quelle, umwandeln);
    const x = eckenFinden(b);
    b.close();
    if (x) setE(x); else await hinweis('Kein Blatt erkannt. Setze die Ecken bitte von Hand.');
  };
  return (
    <div className="bogen-ecken">
      <p className="hinweis klein">Zieh die vier Punkte auf die Ecken des Blatts.</p>
      <div className="bogen-eckbild">
        <img src={url} alt="Foto der Seite" draggable={false} />
        <svg ref={svg} viewBox={`0 0 ${s.breiteQ} ${s.hoeheQ}`} preserveAspectRatio="none"
          onPointerMove={(ev) => { if (zieht.current == null) return; const p = punkt(ev); setE((a) => a.map((x, i) => (i === zieht.current ? p : x))); }}
          onPointerUp={() => { zieht.current = null; }} onPointerCancel={() => { zieht.current = null; }}>
          <polygon points={e.map((p) => `${p.x},${p.y}`).join(' ')} className="bogen-flaeche" />
          {e.map((p, i) => (
            <g key={i} onPointerDown={(ev) => { zieht.current = i; svg.current?.setPointerCapture(ev.pointerId); ev.preventDefault(); }}>
              <circle cx={p.x} cy={p.y} r={griff * 1.8} className="bogen-fang" />
              <circle cx={p.x} cy={p.y} r={griff * 0.55} className="bogen-griff" />
            </g>
          ))}
        </svg>
      </div>
      <div className="buttons">
        <button type="button" onClick={() => props.onFertig(undefined)}>Abbrechen</button>
        <button type="button" onClick={erkennen}>Automatisch erkennen</button>
        <button type="button" onClick={() => props.onFertig(null)}>Ganzes Foto</button>
        <span className="spacer" />
        <button type="button" className="primary" onClick={() => props.onFertig(e)}>Übernehmen</button>
      </div>
    </div>
  );
}
