// Photos straight from the camera: a button that opens the phone's camera (on a computer an image picker), and the
// receipt photo that is read and then opened for booking.
import { useState } from 'react';
import * as I from 'lucide-react';
import { call, fehler, type Row } from './api';
import { DokumentDialog } from './views/Archiv';

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const handy = () => matchMedia('(pointer: coarse)').matches;

export function FotoKnopf(props: { opt: Row; onFertig?: (ids: number[]) => void; label?: string; klein?: boolean }) {
  const [laeuft, setLaeuft] = useState(false);
  return (
    <button className={props.klein ? 'icon' : undefined} title="Foto aufnehmen" disabled={laeuft} onClick={async () => {
      setLaeuft(true);
      try {
        const r = await window.hv.fotoAufnehmen({ status: 'abgelegt', ...props.opt });
        for (const x of r) await call('dokumentSpeichern', { id: x.id, typ: 'Foto', ...props.opt });
        if (r.length) props.onFertig?.(r.map((x) => x.id));
      } catch (e) { fehler(e); } finally { setLaeuft(false); }
    }}><I.Camera size={15} />{props.klein ? null : <> {laeuft ? 'Lädt …' : props.label ?? 'Foto'}</>}</button>
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
