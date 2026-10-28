// Writing an e-mail from Mietshaus: recipient, subject, text and documents of the archive as attachments. With a
// sending server set up (Einstellungen → E-Mail-Versand) the server sends it and files it in the archive; otherwise
// the mail program opens (mailto, without attachments).
import { useEffect, useState } from 'react';
import { call, fehler, type Row } from './api';
import { anfrage } from './bruecke';

type Vorlage = { an?: string; betreff?: string; text?: string; dokumente?: { id: number; titel: string }[];
  ablage?: { objekt_id?: number | null; person_id?: number | null; einheit_id?: number | null } };

let zeigen: ((v: Vorlage | null) => void) | null = null;
let smtp: Promise<boolean> | null = null;
const smtpDa = () => (smtp ??= call<Row>('einstellungen').then((e) => !!e.smtp_server, () => false));
window.addEventListener('hv-smtp-geaendert', () => { smtp = null; });

// Opens the dialog (or the mail program when no sending server is set up).
export async function emailSchreiben(v: Vorlage) {
  if (zeigen && await smtpDa()) return zeigen(v);
  const teile = [v.betreff && `subject=${encodeURIComponent(v.betreff)}`, v.text && `body=${encodeURIComponent(v.text)}`].filter(Boolean).join('&');
  window.hv.extern(`mailto:${v.an ?? ''}${teile ? `?${teile}` : ''}`);
}

export function MailHost() {
  const [v, setV] = useState<Vorlage | null>(null);
  const [f, setF] = useState({ an: '', betreff: '', text: '' });
  const [dokumente, setDokumente] = useState<{ id: number; titel: string }[]>([]);
  const [laeuft, setLaeuft] = useState(false);
  useEffect(() => { zeigen = (x) => { setV(x); if (x) { setF({ an: x.an ?? '', betreff: x.betreff ?? '', text: x.text ?? '' }); setDokumente(x.dokumente ?? []); } }; return () => { zeigen = null; }; }, []);
  if (!v) return null;
  const senden = async () => {
    setLaeuft(true);
    try {
      await anfrage('/api/mail/senden', { json: { ...f, dokumente: dokumente.map((d) => d.id), ablage: v.ablage ?? {} } });
      setV(null);
      window.dispatchEvent(new CustomEvent('hv-meldung', { detail: `E-Mail an ${f.an} gesendet und im Archiv abgelegt.` }));
    } catch (e) { fehler(e); } finally { setLaeuft(false); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !laeuft && setV(null)}>
      <div className="dialog">
        <h2>E-Mail schreiben</h2>
        <div className="maske">
          <label className="breit">An<input autoFocus value={f.an} onChange={(e) => setF({ ...f, an: e.target.value })} placeholder="name@beispiel.de" /></label>
          <label className="breit">Betreff<input value={f.betreff} onChange={(e) => setF({ ...f, betreff: e.target.value })} /></label>
          <label className="breit">Text<textarea rows={10} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></label>
        </div>
        {dokumente.length > 0 && (
          <p className="klein">Anhänge: {dokumente.map((d) => (
            <span key={d.id} className="chip">{d.titel} <button className="link" title="Entfernen" onClick={() => setDokumente(dokumente.filter((x) => x.id !== d.id))}>×</button></span>
          ))}</p>
        )}
        <p className="klein hinweis">Die gesendete E-Mail wird mit ihren Anhängen im Archiv abgelegt.</p>
        <div className="buttons"><span className="spacer" />
          <button onClick={() => setV(null)} disabled={laeuft}>Abbrechen</button>
          <button className="primary" onClick={senden} disabled={laeuft || !f.an || !f.betreff}>{laeuft ? 'Sendet …' : 'Senden'}</button>
        </div>
      </div>
    </div>
  );
}
