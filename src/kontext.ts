// Right-click menu on any linked record (native macOS menu) and the filing target for drag & drop.
import { call, fehler, type Row } from './api';
import { aktionSetzen } from './aktion';
import type { Ziel } from './navi';
import { bestaetigen } from './frage';

type Navi = { zu: (z: Ziel) => void };
type Eintrag = { id: string; label: string; enabled?: boolean } | '-';

// Where a dropped file goes when it lands on a record.
export async function zielZuordnung(key: string): Promise<{ felder: Row; label: string }> {
  const i = await call('zielInfo', key);
  if (!i) return { felder: {}, label: '' };
  switch (i.art) {
    case 'person': return { felder: { person_id: i.person_id, objekt_id: i.objekt_id }, label: `bei ${i.name}` };
    case 'einheit': return { felder: { einheit_id: i.einheit_id, objekt_id: i.objekt_id }, label: `bei ${i.name}` };
    case 'vertrag': return { felder: { person_id: i.person_id, einheit_id: i.einheit_id, objekt_id: i.objekt_id }, label: `bei ${i.name}` };
    case 'objekt': return { felder: { objekt_id: i.objekt_id }, label: `bei ${i.name}` };
    case 'buchung': return { felder: { buchung_id: i.buchung_id, objekt_id: i.objekt_id }, label: `als Beleg zu „${i.name}“` };
    default: return { felder: {}, label: '' };
  }
}

async function ablegen(felder: Row, melden: (t: string) => void, label: string) {
  const r = await window.hv.dateienImportieren({ ...felder, status: 'abgelegt' });
  if (r.length) melden(`${r.length} Datei(en) ${label} abgelegt.`);
}

export async function kontextmenue(key: string, navi: Navi, melden: (t: string) => void) {
  const i = await call('zielInfo', key);
  if (!i) return;
  let eintraege: Eintrag[] = [];
  const brief = (art: 'm' | 'e', vertragId: number, objektId: number) => {
    sessionStorage.setItem('briefAn', JSON.stringify([`${art}${vertragId}`]));
    navi.zu({ seite: 'briefe', objektId, modus: art === 'e' ? 'weg' : 'miete' });
  };
  switch (i.art) {
    case 'person':
      eintraege = [
        { id: 'oeffnen', label: 'Steckbrief öffnen' },
        ...(i.vertrag ? [{ id: 'vertrag', label: i.vertrag.typ === 'weg' ? 'Eigentum öffnen' : 'Mietvertrag öffnen' }] : []),
        '-',
        { id: 'mail', label: 'E-Mail schreiben', enabled: !!i.email },
        { id: 'brief', label: 'Brief schreiben', enabled: !!i.vertrag },
        { id: 'dok', label: 'Dokument ablegen…' },
        '-',
        { id: 'bearbeiten', label: 'Bearbeiten…' },
      ];
      break;
    case 'einheit':
      eintraege = [
        { id: 'oeffnen', label: 'Steckbrief öffnen' },
        ...(i.mieter ? [{ id: 'mieter', label: 'Mieter öffnen' }] : []),
        ...(i.eigentum ? [{ id: 'eigentum', label: 'Eigentümer öffnen' }] : []),
        '-',
        { id: 'dok', label: 'Fotos & Dokumente ablegen…' },
        { id: 'zaehler', label: 'Zählerstand erfassen' },
      ];
      break;
    case 'vertrag':
      eintraege = [
        { id: 'oeffnen', label: i.typ === 'weg' ? 'Eigentum öffnen' : 'Mietvertrag öffnen' },
        { id: 'person', label: i.typ === 'weg' ? 'Eigentümer öffnen' : 'Mieter öffnen' },
        { id: 'einheit', label: 'Einheit öffnen' },
        '-',
        { id: 'konto', label: 'Kontoauszug', enabled: !!i.konto_id },
        { id: 'zahlung', label: 'Zahlung buchen', enabled: !!i.konto_id },
        { id: 'op', label: 'Offene Posten & Mahnen' },
        { id: 'raten', label: 'Ratenzahlung vereinbaren…' },
        ...(i.typ === 'miete' && i.aktuell ? [{ id: 'kuendigung', label: 'Kündigung erfassen…' }] : []),
        '-',
        { id: 'brief', label: 'Brief schreiben' },
        { id: 'mail', label: 'E-Mail schreiben', enabled: !!i.email },
        { id: 'dok', label: 'Dokument ablegen…' },
      ];
      break;
    case 'objekt':
      eintraege = [{ id: 'oeffnen', label: 'Steckbrief öffnen' }, { id: 'einheiten', label: 'Einheiten' }, { id: 'buchen', label: 'Buchungen' }, '-', { id: 'dok', label: 'Dokument ablegen…' }];
      break;
    case 'konto':
      eintraege = [{ id: 'oeffnen', label: 'Kontoauszug öffnen' }, ...(i.vertrag ? [{ id: 'vertrag', label: 'Vertrag öffnen' }] : [])];
      break;
    case 'buchung':
      eintraege = [
        { id: 'beleg', label: 'Beleg öffnen', enabled: !!i.dok_id },
        { id: 'dok', label: 'Beleg zuordnen…' },
        '-',
        { id: 'soll', label: 'Soll-Konto öffnen' },
        { id: 'haben', label: 'Haben-Konto öffnen' },
        '-',
        { id: 'storno', label: 'Stornieren…', enabled: !i.storniert && i.art_buchung !== 'storno' },
      ];
      break;
    case 'dokument':
      eintraege = [{ id: 'oeffnen', label: 'Öffnen' }];
      break;
    case 'vorgang':
      eintraege = [{ id: 'oeffnen', label: 'Vorgang öffnen' }];
      break;
  }
  const wahl = await window.hv.kontextmenue(eintraege);
  if (!wahl) return;
  try {
    switch (`${i.art}:${wahl}`) {
      case 'person:oeffnen': return navi.zu({ person: i.person_id });
      case 'person:vertrag': return navi.zu({ vertrag: i.vertrag.id, typ: i.vertrag.typ });
      case 'person:mail': case 'vertrag:mail': return window.hv.extern(`mailto:${i.email}`);
      case 'person:brief': return brief(i.vertrag.typ === 'weg' ? 'e' : 'm', i.vertrag.id, i.objekt_id);
      case 'person:dok': return ablegen({ person_id: i.person_id, objekt_id: i.objekt_id }, melden, `bei ${i.name}`);
      case 'person:bearbeiten': aktionSetzen('person-bearbeiten'); return navi.zu({ person: i.person_id });
      case 'einheit:oeffnen': return navi.zu({ einheit: i.einheit_id });
      case 'einheit:mieter': return navi.zu({ vertrag: i.mieter.id, typ: 'miete' });
      case 'einheit:eigentum': return navi.zu({ vertrag: i.eigentum.id, typ: 'weg' });
      case 'einheit:dok': return ablegen({ einheit_id: i.einheit_id, objekt_id: i.objekt_id }, melden, `bei ${i.name}`);
      case 'einheit:zaehler': return navi.zu({ seite: 'zaehler', objektId: i.objekt_id });
      case 'vertrag:oeffnen': return navi.zu({ vertrag: i.vertrag_id, typ: i.typ });
      case 'vertrag:person': return navi.zu({ person: i.person_id });
      case 'vertrag:einheit': return navi.zu({ einheit: i.einheit_id });
      case 'vertrag:konto': return navi.zu({ konto: i.konto_id });
      case 'vertrag:zahlung':
        sessionStorage.setItem('buchungVorlage', JSON.stringify({ art: 'einnahme', gegen_id: i.konto_id, text: `Zahlung ${i.name}` }));
        return navi.zu({ seite: 'buchen', objektId: i.objekt_id, aktion: 'neue-buchung' });
      case 'vertrag:op': return navi.zu({ seite: 'op', objektId: i.objekt_id, modus: i.typ === 'weg' ? 'weg' : 'miete' });
      case 'vertrag:raten': aktionSetzen('vertrag-raten'); return navi.zu({ vertrag: i.vertrag_id, typ: i.typ });
      case 'vertrag:kuendigung': aktionSetzen('vertrag-kuendigung'); return navi.zu({ vertrag: i.vertrag_id, typ: i.typ });
      case 'vertrag:brief': return brief(i.typ === 'weg' ? 'e' : 'm', i.vertrag_id, i.objekt_id);
      case 'vertrag:dok': return ablegen({ person_id: i.person_id, einheit_id: i.einheit_id, objekt_id: i.objekt_id }, melden, `bei ${i.name}`);
      case 'objekt:oeffnen': return navi.zu({ objekt: i.objekt_id });
      case 'objekt:einheiten': return navi.zu({ seite: 'einheiten', objektId: i.objekt_id });
      case 'objekt:buchen': return navi.zu({ seite: 'buchen', objektId: i.objekt_id });
      case 'objekt:dok': return ablegen({ objekt_id: i.objekt_id }, melden, `bei ${i.name}`);
      case 'konto:oeffnen': return navi.zu({ konto: i.konto_id });
      case 'konto:vertrag': return navi.zu({ vertrag: i.vertrag.id, typ: i.vertrag.typ });
      case 'buchung:beleg': return navi.zu({ dokument: i.dok_id });
      case 'buchung:dok': return ablegen({ buchung_id: i.buchung_id, objekt_id: i.objekt_id }, melden, `als Beleg zu „${i.name}“`);
      case 'buchung:soll': return navi.zu({ konto: i.soll_id });
      case 'buchung:haben': return navi.zu({ konto: i.haben_id });
      case 'buchung:storno':
        if (!await bestaetigen('Buchung stornieren (Gegenbuchung mit heutigem Datum)?')) return;
        await call('buchungStornieren', i.buchung_id);
        return melden('Buchung storniert.');
      case 'dokument:oeffnen': return navi.zu({ dokument: i.dokument_id, datei: i.datei });
      case 'vorgang:oeffnen': return navi.zu({ vorgang: i.vorgang_id, objektId: i.objekt_id });
    }
  } catch (e) {
    fehler(e);
  }
}
