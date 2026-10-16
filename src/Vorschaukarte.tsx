// Preview card: resting the mouse on a person's name shows contact data and the state of their contracts.
import { useEffect, useState } from 'react';
import * as I from 'lucide-react';
import { call, euro, type Row } from './api';
import { L, useNavi } from './navi';
import { Chip, initialen } from './ui';

export function Vorschaukarte() {
  const navi = useNavi();
  const [ziel, setZiel] = useState<{ id: number; rect: DOMRect } | null>(null);
  const [daten, setDaten] = useState<Row | null>(null);

  useEffect(() => {
    let rein: ReturnType<typeof setTimeout> | undefined, raus: ReturnType<typeof setTimeout> | undefined;
    let aktuell: Element | null = null;
    const ueber = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest?.('.vorschaukarte')) { clearTimeout(raus); return; }
      const el = t.closest?.('[data-person]');
      if (!el || el === aktuell) return;
      clearTimeout(rein); clearTimeout(raus);
      aktuell = el;
      rein = setTimeout(() => setZiel({ id: Number(el.getAttribute('data-person')), rect: el.getBoundingClientRect() }), 500);
    };
    const weg = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.('[data-person], .vorschaukarte');
      if (!el || el.contains(e.relatedTarget as Node)) return;
      clearTimeout(rein);
      aktuell = null;
      raus = setTimeout(() => setZiel(null), 280);
    };
    const schliessen = () => { clearTimeout(rein); aktuell = null; setZiel(null); };
    const klick = (e: MouseEvent) => { if (!(e.target as Element).closest?.('.vorschaukarte')) schliessen(); };
    document.addEventListener('mouseover', ueber);
    document.addEventListener('mouseout', weg);
    window.addEventListener('scroll', schliessen, true);
    window.addEventListener('hv-navigiert', schliessen);
    window.addEventListener('mousedown', klick);
    return () => {
      clearTimeout(rein); clearTimeout(raus);
      document.removeEventListener('mouseover', ueber);
      document.removeEventListener('mouseout', weg);
      window.removeEventListener('scroll', schliessen, true);
      window.removeEventListener('hv-navigiert', schliessen);
      window.removeEventListener('mousedown', klick);
    };
  }, []);

  useEffect(() => {
    if (!ziel) return setDaten(null);
    let aktiv = true;
    call('personKarte', ziel.id).then((d) => aktiv && setDaten(d));
    return () => { aktiv = false; };
  }, [ziel?.id]);

  if (!ziel || !daten) return null;
  const p = daten.person;
  const breite = 320;
  const links = Math.max(8, Math.min(ziel.rect.left, window.innerWidth - breite - 12));
  const unten = ziel.rect.bottom + 230 > window.innerHeight;
  const stil = unten ? { left: links, bottom: window.innerHeight - ziel.rect.top + 6 } : { left: links, top: ziel.rect.bottom + 6 };
  return (
    <div className="vorschaukarte" style={{ ...stil, width: breite }} role="dialog" aria-label={`Vorschau ${p.name}`}>
      <div className="vk-kopf">
        <div className="avatar klein">{initialen(p.name)}</div>
        <div><b>{[p.vorname, p.nachname].filter(Boolean).join(' ') || p.firma}</b>
          <div className="klein hinweis">{daten.vertraege.map((v: Row) => (v.typ === 'weg' ? 'Eigentümer' : 'Mieter') + ' ' + v.einheit).join(' · ') || daten.rollen.map((r: Row) => r.rolle).join(' · ') || 'Kontakt'}</div>
        </div>
      </div>
      <div className="vk-zeilen">
        {(p.telefon || p.mobil) && <div><I.Phone size={13} /><span className="waehlbar">{[p.telefon, p.mobil].filter(Boolean).join(' · ')}</span></div>}
        {p.email && <div><I.Mail size={13} /><span className="waehlbar">{p.email}</span></div>}
        {[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).length > 0 && <div><I.MapPin size={13} /><span>{[p.strasse, [p.plz, p.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</span></div>}
      </div>
      {daten.vertraege.length > 0 && (
        <div className="vk-vertraege">
          {daten.vertraege.map((v: Row) => (
            <div key={v.typ + v.id} className="zeile">
              <L zu={{ vertrag: v.id, typ: v.typ }}>{v.einheit}</L>
              <span className="spacer" />
              <span className="klein">{euro(v.monatlich_ct)}</span>
              {v.ueberfaellig_ct > 0 ? <Chip art="rot">{euro(v.ueberfaellig_ct)} offen</Chip> : <Chip art="gruen">ok</Chip>}
            </div>
          ))}
        </div>
      )}
      <div className="vk-knoepfe">
        <button className="primary" onClick={() => { setZiel(null); navi.zu({ person: p.id }); }}>Steckbrief öffnen</button>
        {p.email && <button onClick={() => window.hv.extern(`mailto:${p.email}`)}>E-Mail</button>}
      </div>
    </div>
  );
}
