import { useEffect, useState, type ReactNode } from 'react';

// Question dialog that can be awaited from anywhere: `await frage({...})` resolves with the id of the chosen option,
// or null when the dialog is closed. <FrageHost /> in the app shell renders it.
type Option = { id: string; label: string; primary?: boolean };
type Frage = { titel: string; text: ReactNode; optionen: Option[] };
type Offen = Frage & { fertig: (id: string | null) => void };

let zeigen: ((f: Offen | null) => void) | null = null;

export const frage = (f: Frage) => new Promise<string | null>((fertig) => (zeigen ? zeigen({ ...f, fertig }) : fertig(null)));

export function FrageHost() {
  const [f, setF] = useState<Offen | null>(null);
  useEffect(() => {
    zeigen = setF;
    return () => { zeigen = null; };
  }, []);
  useEffect(() => {
    if (!f) return;
    const taste = (e: KeyboardEvent) => { if (e.key === 'Escape') { setF(null); f.fertig(null); } };
    document.addEventListener('keydown', taste);
    return () => document.removeEventListener('keydown', taste);
  }, [f]);
  if (!f) return null;
  const ende = (id: string | null) => { setF(null); f.fertig(id); };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && ende(null)}>
      <div className="dialog">
        <h2>{f.titel}</h2>
        {f.text}
        <div className="buttons">
          <span className="spacer" />
          {f.optionen.map((o) => <button key={o.id} className={o.primary ? 'primary' : ''} onClick={() => ende(o.id)}>{o.label}</button>)}
        </div>
      </div>
    </div>
  );
}
