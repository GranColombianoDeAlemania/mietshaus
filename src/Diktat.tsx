// Speaking instead of typing: the browser's speech recognition (Safari on iPhone and Mac). Where there is none – the
// Mac app's window among them – the button is not shown; the keyboard's dictation works everywhere. Before the first use
// on a device the user is told that the speech is processed by the system (Apple), as with keyboard dictation.
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { bestaetigen } from './frage';

type Erkennung = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: any) => void) | null; onerror: ((e: any) => void) | null; onend: (() => void) | null };

const Klasse = (): (new () => Erkennung) | null => {
  if ((window as any).hvDesktop) return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
};
export const diktatMoeglich = () => !!Klasse();

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const schreiben = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

async function erlaubt() {
  if (lesen('diktat_ok') === '1') return true;
  const ok = await bestaetigen('Die Spracherkennung des Geräts wandelt das Gesprochene in Text um. Dabei verarbeitet der Hersteller (bei Safari: Apple) die Aufnahme – wie beim Diktieren über die Tastatur. Mietshaus selbst bekommt nur den Text.',
    { titel: 'Spracheingabe nutzen?', ja: 'Ja, nutzen' });
  if (ok) schreiben('diktat_ok', '1');
  return ok;
}

// The microphone button: while it listens the text so far is shown; at the end onText gets the result.
export function DiktatKnopf(props: { onText: (text: string) => void; sofort?: boolean; label?: string }) {
  const [hoert, setHoert] = useState(false);
  const [zwischen, setZwischen] = useState('');
  const erkennung = useRef<Erkennung | null>(null);
  const K = Klasse();

  async function starten() {
    if (!K || hoert || !await erlaubt()) return;
    const e = new K();
    e.lang = 'de-DE';
    e.interimResults = true;
    e.continuous = false;
    let text = '';
    e.onresult = (ev) => {
      text = Array.from(ev.results as ArrayLike<any>).map((r) => r[0].transcript).join(' ');
      setZwischen(text);
    };
    e.onerror = (ev) => { if (ev.error === 'not-allowed') schreiben('diktat_ok', ''); };
    e.onend = () => { setHoert(false); setZwischen(''); erkennung.current = null; if (text.trim()) props.onText(text.trim()); };
    erkennung.current = e;
    setHoert(true);
    e.start();
  }
  useEffect(() => { if (props.sofort) starten(); return () => erkennung.current?.abort(); }, []);
  if (!K) return null;
  return (
    <span className="diktat">
      <button type="button" className={hoert ? 'hoert' : ''} aria-pressed={hoert} title={hoert ? 'Zuhören beenden' : 'Sprechen statt tippen'}
        onClick={() => (hoert ? erkennung.current?.stop() : starten())}>
        {hoert ? <MicOff size={15} /> : <Mic size={15} />} {hoert ? 'Fertig' : props.label ?? 'Diktieren'}
      </button>
      {hoert && <span className="klein hinweis diktat-text">{zwischen || 'Ich höre zu …'}</span>}
    </span>
  );
}
