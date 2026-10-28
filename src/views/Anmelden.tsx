// Start screen of the server: set up the first user, or log in. The Mac app in local mode never sees it.
import { useEffect, useState, type ReactNode } from 'react';
import * as I from 'lucide-react';
import { anmelden, einrichten, passkeyAnmelden, passkeyMoeglich, status } from '../bruecke';

type Status = Awaited<ReturnType<typeof status>>;

export function Start(props: { children: (s: Status) => ReactNode }) {
  const [s, setS] = useState<Status | null>(null);
  const [fehler, setFehler] = useState('');
  const laden = () => status().then(setS, () => setFehler('Der Mietshaus-Server ist nicht erreichbar. Läuft er, und ist Tailscale verbunden?'));
  useEffect(() => {
    laden();
    const ab = () => laden();
    window.addEventListener('hv-abgemeldet', ab);
    return () => window.removeEventListener('hv-abgemeldet', ab);
  }, []);
  if (fehler) return <Rahmen><p className="fehlertext">{fehler}</p><button onClick={() => { setFehler(''); laden(); }}>Erneut versuchen</button></Rahmen>;
  if (!s) return null;
  // An invitation link (…/?einladung=…) opens the page to set the password, also when someone is still logged in.
  const einladung = new URLSearchParams(location.search).get('einladung');
  if (einladung && s.modus === 'server') return <EinladungAnnehmen token={einladung} fertig={() => { history.replaceState(null, '', '/'); laden(); }} />;
  if (s.angemeldet) return <>{props.children(s)}</>;
  return <Anmelden einrichtung={s.einrichtung} fertig={laden} />;
}

function Rahmen(props: { children: ReactNode }) {
  return (
    <div className="anmelden">
      <form className="panel" onSubmit={(e) => e.preventDefault()}>
        <div className="marke"><img src="/logo.svg" alt="" width={44} height={44} /><span>Mietshaus</span></div>
        {props.children}
      </form>
    </div>
  );
}

function Anmelden(props: { einrichtung: boolean; fertig: () => void }) {
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [fehler, setFehler] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const los = async () => {
    setFehler('');
    if (props.einrichtung && pw !== pw2) return setFehler('Die Passwörter stimmen nicht überein.');
    setLaeuft(true);
    try {
      if (props.einrichtung) await einrichten(login.trim(), name.trim(), pw);
      else await anmelden(login.trim(), pw);
      props.fertig();
    } catch (e) { setFehler(String((e as Error).message)); } finally { setLaeuft(false); }
  };
  return (
    <Rahmen>
      <h2>{props.einrichtung ? 'Ersten Benutzer anlegen' : 'Anmelden'}</h2>
      {props.einrichtung && <p className="hinweis">Der Server ist neu. Lege den ersten Benutzer an; weitere Personen fügst du danach unter Einstellungen → Benutzer hinzu.</p>}
      <label>{props.einrichtung ? 'Benutzername wählen' : 'Benutzername'}
        <input autoFocus autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} placeholder={props.einrichtung ? 'z. B. max' : ''} /></label>
      {props.einrichtung && <p className="klein hinweis">Damit meldest du dich künftig an – kurz, ohne Leerzeichen.</p>}
      {props.einrichtung && <label>Angezeigter Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Max Mustermann" /></label>}
      <label>Passwort<input type="password" autoComplete={props.einrichtung ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      {props.einrichtung && <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>}
      {props.einrichtung && <p className="klein hinweis">Mindestens 10 Zeichen.</p>}
      {fehler && <p className="fehlertext">{fehler}</p>}
      <button type="submit" className="primary" disabled={laeuft || !login || !pw} onClick={los}>{props.einrichtung ? 'Anlegen und anmelden' : 'Anmelden'}</button>
      {!props.einrichtung && passkeyMoeglich() && (
        <button type="button" disabled={laeuft} onClick={async () => {
          setFehler('');
          setLaeuft(true);
          try { await passkeyAnmelden(); props.fertig(); } catch (e) {
            // Cancelling the system dialog is no error worth showing.
            if ((e as Error).name !== 'NotAllowedError') setFehler(String((e as Error).message));
          } finally { setLaeuft(false); }
        }}>Mit Passkey anmelden (Touch ID / Face ID)</button>
      )}
    </Rahmen>
  );
}

// The invited person (or someone who forgot the password) chooses a password with the one-time link.
function EinladungAnnehmen(props: { token: string; fertig: () => void }) {
  const [info, setInfo] = useState<{ login: string; name: string; neu: boolean } | null>(null);
  const [fehler, setFehler] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => {
    fetch(`/api/einladung?token=${encodeURIComponent(props.token)}`).then(async (r) => {
      const j = await r.json();
      if (r.ok) setInfo(j); else setFehler(j.fehler ?? 'Diese Einladung gilt nicht.');
    }, () => setFehler('Der Mietshaus-Server ist nicht erreichbar. Läuft Tailscale?'));
  }, [props.token]);
  const los = async () => {
    setFehler('');
    if (pw !== pw2) return setFehler('Die Passwörter stimmen nicht überein.');
    setLaeuft(true);
    try {
      const r = await fetch('/api/einladung', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mietshaus': '1' }, body: JSON.stringify({ token: props.token, passwort: pw }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.fehler);
      props.fertig();
    } catch (e) { setFehler(String((e as Error).message)); } finally { setLaeuft(false); }
  };
  return (
    <Rahmen>
      {!info ? <>
        <h2>Einladung</h2>
        {fehler ? <p className="fehlertext">{fehler}</p> : <p className="hinweis">Einen Moment …</p>}
        {fehler && <button type="button" onClick={props.fertig}>Zur Anmeldung</button>}
      </> : <>
        <h2>{info.neu ? `Willkommen, ${info.name}!` : `Neues Passwort für ${info.name}`}</h2>
        <p className="hinweis">{info.neu ? 'Du wurdest zu Mietshaus eingeladen. Leg jetzt dein Passwort fest – danach bist du angemeldet.' : 'Leg ein neues Passwort fest.'}</p>
        <p className="klein">Dein Benutzername: <b>{info.login}</b></p>
        <label>Passwort<input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label>Passwort wiederholen<input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></label>
        <p className="klein hinweis">Mindestens 10 Zeichen.</p>
        {fehler && <p className="fehlertext">{fehler}</p>}
        <button type="submit" className="primary" disabled={laeuft || !pw} onClick={los}>Passwort festlegen und anmelden</button>
      </>}
    </Rahmen>
  );
}
