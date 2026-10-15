import { useEffect, useState } from 'react';
import { call, OBJEKT_ART, type Modus, type Row } from './api';
import { useLoad } from './useLoad';
import { Uebersicht } from './views/Uebersicht';
import { Objekte } from './views/Objekte';
import { Einheiten } from './views/Einheiten';
import { Vertraege } from './views/Vertraege';
import { Schluessel } from './views/Schluessel';
import { Personen } from './views/Personen';

type Seite = 'uebersicht' | 'objekte' | 'einheiten' | 'vertraege' | 'schluessel' | 'personen';

// Upcoming areas from PLAN.md, shown so the roadmap stays visible in the app.
const GEPLANT: Record<Modus, string[]> = {
  miete: ['Zähler', 'Buchhaltung', 'Sollstellung & Mahnwesen', 'Bank & SEPA', 'Nebenkostenabrechnung', 'Heizkosten',
    'Kaution & Indexmiete', 'Briefe & Dokumente', 'Vorgänge & Termine', 'DATEV & Export'],
  weg: ['Zähler', 'Buchhaltung', 'Sollstellung & Mahnwesen', 'Bank & SEPA', 'Hausgeldabrechnung', 'Wirtschaftsplan',
    'Rücklagen', 'Versammlungen & Beschlüsse', 'Briefe & Dokumente', 'Vorgänge & Termine', 'DATEV & Export'],
};

const lesen = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const schreiben = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {}
};

export default function App() {
  const [modus, setModus] = useState<Modus>(() => (lesen('modus') === 'weg' ? 'weg' : 'miete'));
  const [seite, setSeite] = useState<Seite>('uebersicht');
  const [objektId, setObjektId] = useState<number | null>(() => Number(lesen(`objekt_${modus}`)) || null);
  const [objekte, ladeObjekte] = useLoad<Row[]>(() => call('objekte', modus), [modus]);

  useEffect(() => {
    document.documentElement.dataset.modus = modus;
    schreiben('modus', modus);
  }, [modus]);

  // Keep a valid object selected for the current mode.
  useEffect(() => {
    if (!objekte) return;
    if (!objekte.some((o) => o.id === objektId)) setObjektId(objekte[0]?.id ?? null);
  }, [objekte]);
  useEffect(() => {
    if (objektId) schreiben(`objekt_${modus}`, String(objektId));
  }, [objektId, modus]);

  function wechsle(m: Modus) {
    setModus(m);
    setObjektId(Number(lesen(`objekt_${m}`)) || null);
  }

  const objekt = objekte?.find((o) => o.id === objektId);
  const vertragsSeite = modus === 'weg' ? 'Eigentümer' : 'Mieter';
  const nav: [Seite, string, boolean][] = [
    ['uebersicht', 'Übersicht', false],
    ['objekte', 'Objekte', false],
    ['einheiten', 'Einheiten', true],
    ['vertraege', vertragsSeite, true],
    ['schluessel', 'Umlageschlüssel', true],
    ['personen', 'Adressbuch', false],
  ];

  const braucheObjekt = nav.find(([s]) => s === seite)?.[2];

  return (
    <div className="app">
      <header>
        <div className="brand">Hausverwalter</div>
        <div className="modus" role="tablist">
          <button role="tab" aria-selected={modus === 'miete'} className="m-miete" onClick={() => wechsle('miete')}>
            Mietverwaltung
          </button>
          <button role="tab" aria-selected={modus === 'weg'} className="m-weg" onClick={() => wechsle('weg')}>
            WEG-Verwaltung
          </button>
        </div>
        <label className="objektwahl">
          Objekt
          <select value={objektId ?? ''} onChange={(e) => setObjektId(Number(e.target.value))} disabled={!objekte?.length}>
            {!objekte?.length && <option value="">– noch keine Objekte –</option>}
            {objekte?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.bezeichnung}{o.art === 'gemischt' ? ' (gemischt)' : ''}
              </option>
            ))}
          </select>
        </label>
      </header>
      <nav>
        {nav.map(([s, label]) => (
          <button key={s} className={seite === s ? 'active' : ''} onClick={() => setSeite(s)}>
            {label}
          </button>
        ))}
        <div className="geplant">
          <h4>In Planung</h4>
          {GEPLANT[modus].map((g) => (
            <div key={g}>{g}</div>
          ))}
        </div>
      </nav>
      <main>
        {braucheObjekt && !objekt ? (
          <div className="leer">
            <p>Bitte zuerst ein Objekt anlegen.</p>
            <button className="primary" onClick={() => setSeite('objekte')}>Zu den Objekten</button>
          </div>
        ) : seite === 'uebersicht' ? (
          <Uebersicht modus={modus} />
        ) : seite === 'objekte' ? (
          <Objekte modus={modus} objekte={objekte ?? []} reload={ladeObjekte} onOpen={(id) => { setObjektId(id); setSeite('einheiten'); }} />
        ) : seite === 'einheiten' ? (
          <Einheiten key={objekt!.id} modus={modus} objekt={objekt!} />
        ) : seite === 'vertraege' ? (
          <Vertraege key={objekt!.id + modus} modus={modus} objekt={objekt!} />
        ) : seite === 'schluessel' ? (
          <Schluessel key={objekt!.id} objekt={objekt!} />
        ) : (
          <Personen />
        )}
      </main>
      <footer>
        {objekt ? `${objekt.bezeichnung} · ${OBJEKT_ART[objekt.art]}` : ''}
      </footer>
    </div>
  );
}
