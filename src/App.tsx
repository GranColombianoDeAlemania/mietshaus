import { useEffect, useState, type ReactNode } from 'react';
import { call, OBJEKT_ART, type Modus, type Row } from './api';
import { useLoad } from './useLoad';
import { Uebersicht } from './views/Uebersicht';
import { Objekte } from './views/Objekte';
import { Einheiten } from './views/Einheiten';
import { Vertraege } from './views/Vertraege';
import { Schluessel } from './views/Schluessel';
import { Personen } from './views/Personen';
import { Zaehler } from './views/Zaehler';
import { Konten } from './views/Konten';
import { Buchen } from './views/Buchen';
import { Sollstellung } from './views/Sollstellung';
import { OffenePosten } from './views/OffenePosten';
import { Bank } from './views/Bank';
import { Einstellungen } from './views/Einstellungen';
import { NkAbrechnung } from './views/NkAbrechnung';
import { WegAbrechnung } from './views/WegAbrechnung';
import { Wirtschaftsplan } from './views/Wirtschaftsplan';
import { Ruecklagen } from './views/Ruecklagen';

type Ctx = { modus: Modus; objekt: Row; objekte: Row[]; ladeObjekte: () => void; oeffne: (seite: string, objektId?: number) => void };
type Seite = {
  id: string;
  label: string | ((m: Modus) => string);
  gruppe: string;
  objekt?: boolean; // needs a selected object
  modi?: Modus[];
  render: (c: Ctx) => ReactNode;
};

const SEITEN: Seite[] = [
  { id: 'uebersicht', label: 'Übersicht', gruppe: 'Stammdaten', render: (c) => <Uebersicht modus={c.modus} /> },
  { id: 'objekte', label: 'Objekte', gruppe: 'Stammdaten', render: (c) => <Objekte modus={c.modus} objekte={c.objekte} reload={c.ladeObjekte} onOpen={(id) => c.oeffne('einheiten', id)} /> },
  { id: 'einheiten', label: 'Einheiten', gruppe: 'Stammdaten', objekt: true, render: (c) => <Einheiten key={c.objekt.id} modus={c.modus} objekt={c.objekt} /> },
  { id: 'vertraege', label: (m) => (m === 'weg' ? 'Eigentümer' : 'Mieter'), gruppe: 'Stammdaten', objekt: true, render: (c) => <Vertraege key={c.objekt.id + c.modus} modus={c.modus} objekt={c.objekt} /> },
  { id: 'zaehler', label: 'Zähler', gruppe: 'Stammdaten', objekt: true, render: (c) => <Zaehler key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'schluessel', label: 'Umlageschlüssel', gruppe: 'Stammdaten', objekt: true, render: (c) => <Schluessel key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'personen', label: 'Adressbuch', gruppe: 'Stammdaten', render: () => <Personen /> },
  { id: 'buchen', label: 'Buchungen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Buchen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'konten', label: 'Konten', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Konten key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'soll', label: 'Sollstellung', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Sollstellung key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'op', label: 'Offene Posten & Mahnungen', gruppe: 'Buchhaltung', objekt: true, render: (c) => <OffenePosten key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'bank', label: 'Bank & SEPA', gruppe: 'Buchhaltung', objekt: true, render: (c) => <Bank key={c.objekt.id + c.modus} objekt={c.objekt} modus={c.modus} /> },
  { id: 'nk', label: 'Betriebskosten', gruppe: 'Abrechnung', objekt: true, modi: ['miete'], render: (c) => <NkAbrechnung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'wegabr', label: 'Jahresabrechnung', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <WegAbrechnung key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'wipl', label: 'Wirtschaftsplan', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <Wirtschaftsplan key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'ruecklagen', label: 'Rücklagen & Sonderumlagen', gruppe: 'Abrechnung', objekt: true, modi: ['weg'], render: (c) => <Ruecklagen key={c.objekt.id} objekt={c.objekt} /> },
  { id: 'einstellungen', label: 'Einstellungen & Sicherung', gruppe: 'System', render: () => <Einstellungen /> },
];

// Upcoming areas from PLAN.md, shown so the roadmap stays visible in the app.
const GEPLANT: Record<Modus, string[]> = {
  miete: ['Kaution & Mietanpassung', 'Briefe & Dokumente', 'Vorgänge & Termine', 'DATEV & Export'],
  weg: ['Versammlungen & Beschlüsse', 'Briefe & Dokumente', 'Vorgänge & Termine', 'DATEV & Export'],
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
  const [seite, setSeite] = useState(() => lesen('seite') ?? 'uebersicht');
  const [objektId, setObjektId] = useState<number | null>(() => Number(lesen(`objekt_${modus}`)) || null);
  const [objekte, ladeObjekte] = useLoad<Row[]>(() => call('objekte', modus), [modus]);

  useEffect(() => {
    document.documentElement.dataset.modus = modus;
    schreiben('modus', modus);
  }, [modus]);
  useEffect(() => schreiben('seite', seite), [seite]);

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
  const sichtbar = SEITEN.filter((s) => !s.modi || s.modi.includes(modus));
  const aktiv = sichtbar.find((s) => s.id === seite) ?? sichtbar[0];
  const label = (s: Seite) => (typeof s.label === 'function' ? s.label(modus) : s.label);
  const gruppen = [...new Set(sichtbar.map((s) => s.gruppe))];

  const ctx: Ctx | null = objekte
    ? { modus, objekt: objekt!, objekte, ladeObjekte, oeffne: (s, id) => { if (id) setObjektId(id); setSeite(s); } }
    : null;

  return (
    <div className="app">
      <header>
        <div className="brand">Hausverwalter</div>
        <div className="modus" role="tablist">
          <button role="tab" aria-selected={modus === 'miete'} onClick={() => wechsle('miete')}>Mietverwaltung</button>
          <button role="tab" aria-selected={modus === 'weg'} onClick={() => wechsle('weg')}>WEG-Verwaltung</button>
        </div>
        <label className="objektwahl">
          Objekt
          <select value={objektId ?? ''} onChange={(e) => setObjektId(Number(e.target.value))} disabled={!objekte?.length}>
            {!objekte?.length && <option value="">– noch keine Objekte –</option>}
            {objekte?.map((o) => (
              <option key={o.id} value={o.id}>{o.bezeichnung}{o.art === 'gemischt' ? ' (gemischt)' : ''}</option>
            ))}
          </select>
        </label>
      </header>
      <nav>
        {gruppen.map((g) => (
          <div key={g} className="navgruppe">
            <h4>{g}</h4>
            {sichtbar.filter((s) => s.gruppe === g).map((s) => (
              <button key={s.id} className={aktiv.id === s.id ? 'active' : ''} onClick={() => setSeite(s.id)}>{label(s)}</button>
            ))}
          </div>
        ))}
        {GEPLANT[modus].length > 0 && (
          <div className="geplant">
            <h4>In Planung</h4>
            {GEPLANT[modus].map((g) => <div key={g}>{g}</div>)}
          </div>
        )}
      </nav>
      <main>
        {!ctx ? null : aktiv.objekt && !objekt ? (
          <div className="leer">
            <p>Bitte zuerst ein Objekt anlegen.</p>
            <button className="primary" onClick={() => setSeite('objekte')}>Zu den Objekten</button>
          </div>
        ) : (
          aktiv.render(ctx)
        )}
      </main>
      <footer>{objekt ? `${objekt.bezeichnung} · ${OBJEKT_ART[objekt.art]}` : ''}</footer>
    </div>
  );
}
