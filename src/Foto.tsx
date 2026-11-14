// Photos straight from the camera: a button that opens the phone's camera (on a computer an image picker), and the
// receipt photo that is read and then opened for booking.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, fehler, type Row } from './api';
import { DokumentDialog } from './views/Archiv';

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const handy = () => matchMedia('(pointer: coarse)').matches;

// video: the camera offers photo and video, the library videos too. On the phone a bar stays after each shot – "Noch
// eins" opens the camera again (each tap is needed: the camera may only open on a tap), "Mediathek" picks several at once.
// On a computer the picker takes several files at once anyway.
export function FotoKnopf(props: { opt: Row; onFertig?: (ids: number[]) => void; label?: string; klein?: boolean; video?: boolean }) {
  const [laeuft, setLaeuft] = useState(false);
  const [serie, setSerie] = useState<number | null>(null);
  const aufnehmen = async (mediathek: boolean) => {
    setLaeuft(true);
    try {
      const r = await window.hv.fotoAufnehmen({ status: 'abgelegt', ...props.opt }, { video: props.video, mediathek: mediathek || !handy() });
      for (const x of r) await call('dokumentSpeichern', { id: x.id, typ: 'Foto', ...props.opt });
      if (r.length) props.onFertig?.(r.map((x) => x.id));
      if (handy() && (r.length || serie != null)) setSerie((serie ?? 0) + r.length);
    } catch (e) { fehler(e); } finally { setLaeuft(false); }
  };
  const was = props.video ? 'Foto oder Video' : 'Foto';
  return (
    <>
      <button type="button" className={props.klein ? 'icon' : undefined} title={`${was} aufnehmen`} aria-label={`${was} aufnehmen`} disabled={laeuft}
        onClick={() => aufnehmen(false)}><I.Camera size={15} />{props.klein ? null : <> {laeuft ? 'Lädt …' : props.label ?? 'Foto'}</>}</button>
      {serie != null && (
        <div className="foto-serie" role="status">
          <span className="foto-serie-zahl"><I.CheckCircle2 size={16} /> {laeuft ? 'Lädt hoch …' : `${serie} aufgenommen`}</span>
          <button type="button" className="primary" disabled={laeuft} onClick={() => aufnehmen(false)}><I.Camera size={15} /> Noch eins</button>
          <button type="button" disabled={laeuft} onClick={() => aufnehmen(true)}><I.Images size={15} /> Mediathek</button>
          <button type="button" disabled={laeuft} onClick={() => setSerie(null)}>Fertig</button>
        </div>
      )}
    </>
  );
}

// Photograph a receipt: upload, wait for the text recognition, then the document opens with amount, date and sender
// filled in – there it is booked. Without a result it stays in the inbox as before.
export function BelegFoto(props: { onFertig?: () => void }) {
  const [stand, setStand] = useState<'' | 'lesen'>('');
  const [offen, setOffen] = useState<Row | null>(null);
  return (
    <>
      <button title="Beleg fotografieren – wird gelesen und zum Buchen geöffnet" disabled={!!stand} onClick={async () => {
        try {
          const [x] = await window.hv.fotoAufnehmen({ status: 'postfach', typ: 'Rechnung' });
          if (!x) return;
          setStand('lesen');
          let d: Row = await call('dokument', x.id);
          for (let i = 0; i < 120 && d.analyse === 'offen'; i++) { await warte(1000); d = await call('dokument', x.id); }
          setOffen(d);
        } catch (e) { fehler(e); } finally { setStand(''); }
      }}><I.Receipt size={15} /> {stand ? 'Beleg wird gelesen …' : 'Beleg fotografieren'}</button>
      {offen && <DokumentDialog id={offen.id} datei={offen.datei} onClose={() => { setOffen(null); props.onFertig?.(); }} />}
    </>
  );
}
