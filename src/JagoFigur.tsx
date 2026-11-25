// Jago, alive: while nobody looks at him two short idle films take turns; pointing at him or clicking plays the one where
// he thinks and pricks up his ears, once, then he is idle again. With „Bewegung reduzieren“ (system setting) the still
// picture. The films are small and silent (public/jago, 320 px); the server answers byte ranges for Safari.
import { useEffect, useRef, useState } from 'react';

const RUHE = ['/jago/ruhe1.mp4', '/jago/ruhe2.mp4'];
const DENKT = '/jago/nachdenkend.mp4';
const ohneBewegung = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// denkt: true while someone points at him (or a window with him opens) – the thinking film starts on each change to true.
export function JagoFigur(props: { groesse: number; denkt?: boolean; className?: string }) {
  const ruhe = useRef<HTMLVideoElement>(null);
  const denk = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState(0);
  const [denktJetzt, setDenktJetzt] = useState(false);
  const [still] = useState(ohneBewegung);

  useEffect(() => {
    const v = denk.current;
    if (still || !v) return;
    if (props.denkt) {
      v.currentTime = 0;
      v.play().then(() => setDenktJetzt(true), () => {});
    } else {
      // Pointer gone: back to idle (the film fades out, then stops).
      setDenktJetzt(false);
      const t = setTimeout(() => v.pause(), 300);
      return () => clearTimeout(t);
    }
  }, [props.denkt, still]);

  // A hidden window plays nothing (battery); visible again, the idle film goes on.
  useEffect(() => {
    if (still) return;
    const sichtbar = () => {
      if (document.hidden) { ruhe.current?.pause(); denk.current?.pause(); }
      else ruhe.current?.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', sichtbar);
    return () => document.removeEventListener('visibilitychange', sichtbar);
  }, [still]);

  return (
    <span className={`jago-figur${denktJetzt ? ' denkt' : ''}${props.className ? ` ${props.className}` : ''}`} style={{ width: props.groesse, height: props.groesse }} aria-hidden="true">
      {still ? <img src="/jago.jpg" alt="" /> : <>
        {/* The idle films take turns (no loop: the other one follows at the end). */}
        <video ref={ruhe} key={clip} src={RUHE[clip]} poster="/jago.jpg" muted playsInline autoPlay preload="auto" disablePictureInPicture
          onEnded={() => setClip((c) => (c + 1) % RUHE.length)} />
        <video ref={denk} className="denk" src={DENKT} muted playsInline preload="auto" disablePictureInPicture onEnded={() => setDenktJetzt(false)} />
      </>}
    </span>
  );
}
