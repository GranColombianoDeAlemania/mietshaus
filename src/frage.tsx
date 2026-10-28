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
    <div className="overlay frage" onMouseDown={(e) => e.target === e.currentTarget && ende(null)}>
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

// Tests answer questions without a dialog (scripts/klicktest.cjs sets window.hvTest).
type Testantwort = { bestaetigen?: (text: string) => boolean; hinweis?: (text: string) => void };
const test = () => (window as unknown as { hvTest?: Testantwort }).hvTest;

const absaetze = (text: string) => text.split('\n').map((z, i) => (z ? <p key={i}>{z}</p> : <br key={i} />));

// Yes/no question in the app's own dialog instead of the browser's confirm(); resolves true for yes.
export async function bestaetigen(text: string, opt: { titel?: string; ja?: string; nein?: string } = {}) {
  const t = test();
  if (t?.bestaetigen) return t.bestaetigen(text);
  const id = await frage({ titel: opt.titel ?? 'Bitte bestätigen', text: <>{absaetze(text)}</>,
    optionen: [{ id: 'nein', label: opt.nein ?? 'Abbrechen' }, { id: 'ja', label: opt.ja ?? 'OK', primary: true }] });
  return id === 'ja';
}

// Message with an OK button instead of alert().
export async function hinweis(text: string, titel = 'Hinweis') {
  const t = test();
  if (t?.hinweis) return t.hinweis(text);
  await frage({ titel, text: <>{absaetze(text)}</>, optionen: [{ id: 'ok', label: 'OK', primary: true }] });
}
