// A dictated note („Herr Meier, Wohnung 3, tropfender Wasserhahn, dringend“) becomes the draft of a case: person, unit
// and house are matched against the own data, urgency and due date from a few words – all here, nothing leaves the
// server. The user checks the draft before saving.
const ortszeit = require('./zeit.cjs');

const falten = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
const plusTage = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const ZAHLWORT = { eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, zwolf: 12 };
const WOCHENTAG = { montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0 };

module.exports = function diktat({ all }) {
  return {
    diktatDeuten: (text, objektId = null) => {
      const roh = String(text ?? '').trim();
      if (!roh) throw new Error('Es wurde nichts erkannt.');
      const t = ortszeit.heute();
      const f = falten(roh);
      const erkannt = [];
      let rest = roh;
      const entferne = (muster) => { rest = rest.replace(muster, ' '); };

      // House: by its name or street, otherwise the one chosen.
      const objekte = all('SELECT id, bezeichnung, strasse FROM objekte ORDER BY length(bezeichnung) DESC');
      let objekt = objekte.find((o) => [o.bezeichnung, o.strasse].some((n) => n && n.length > 3 && f.includes(falten(n)))) ?? null;
      if (objekt) { erkannt.push(`Objekt ${objekt.bezeichnung}`); entferne(new RegExp(objekt.bezeichnung.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); }
      const oid = objekt?.id ?? (objektId ? Number(objektId) : null);

      // Unit: its name („EG links“) or „Wohnung 3“ / „WE 3“ / „Einheit drei“ against the unit number.
      const einheiten = all(`SELECT e.id, e.nr, e.bezeichnung, e.objekt_id FROM einheiten e ${oid ? 'WHERE e.objekt_id = ?' : ''} ORDER BY length(e.bezeichnung) DESC`, ...(oid ? [oid] : []));
      let einheit = einheiten.find((e) => e.bezeichnung && e.bezeichnung.length > 2 && f.includes(falten(e.bezeichnung))) ?? null;
      if (einheit) entferne(new RegExp(einheit.bezeichnung.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      if (!einheit) {
        const m = f.match(/\b(?:wohnung|we|einheit|whg)\.?\s*(?:nr\.?\s*)?(\d+|[a-z]+)\b/);
        const nr = m ? (/^\d+$/.test(m[1]) ? Number(m[1]) : ZAHLWORT[m[1]]) : null;
        if (nr) { einheit = einheiten.find((e) => Number(e.nr) === nr) ?? null; if (einheit) entferne(/\b(?:Wohnung|WE|Einheit|Whg)\.?\s*(?:Nr\.?\s*)?\S+/i); }
      }
      if (einheit) { erkannt.push(`Einheit ${einheit.bezeichnung}`); objekt ??= objekte.find((o) => o.id === einheit.objekt_id) ?? null; }

      // Person: surname or company, preferably the current tenant of the unit; „Herr/Frau“ before it is dropped.
      const personen = all(`SELECT p.id, p.vorname, p.nachname, p.firma,
          (SELECT m.einheit_id FROM mietverhaeltnisse m WHERE (m.person_id = p.id OR m.person2_id = p.id) AND m.beginn <= ?1 AND (m.ende IS NULL OR m.ende = '' OR m.ende >= ?1) LIMIT 1) AS einheit_id
        FROM personen p`, t);
      const treffer = personen.filter((p) => [p.nachname, p.firma].some((n) => n && n.length > 2 && new RegExp(`\\b${falten(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(f)));
      const person = treffer.find((p) => einheit && p.einheit_id === einheit.id) ?? treffer[0] ?? null;
      if (person) {
        const n = person.nachname || person.firma;
        erkannt.push(`Person ${[person.vorname, person.nachname].filter(Boolean).join(' ') || person.firma}`);
        entferne(new RegExp(`\\b(?:Herr|Herrn|Frau|Familie|Fam\\.)?\\s*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
        // The tenant's unit when none was said.
        if (!einheit && person.einheit_id) { einheit = einheiten.find((e) => e.id === person.einheit_id) ?? all('SELECT id, bezeichnung, objekt_id FROM einheiten WHERE id = ?', person.einheit_id)[0] ?? null; if (einheit) erkannt.push(`Einheit ${einheit.bezeichnung} (Mieter)`); }
      }
      // A unit found through its tenant belongs to its house as well.
      if (einheit && !objekt && einheit.objekt_id) objekt = objekte.find((o) => o.id === einheit.objekt_id) ?? null;

      // Urgency and due date.
      let prioritaet = 2;
      if (/\b(dringend|sofort|notfall|eilig|asap)\b/.test(f)) { prioritaet = 1; erkannt.push('dringend'); entferne(/\b(dringend|sofort|Notfall|eilig|asap)\b/gi); }
      else if (/\bbei gelegenheit\b|\bnicht eilig\b/.test(f)) { prioritaet = 3; entferne(/\b(bei Gelegenheit|nicht eilig)\b/gi); }
      let faellig = null;
      const tage = f.match(/\bin (\d+|[a-z]+) tagen\b/);
      if (/\bubermorgen\b|\buebermorgen\b/.test(f)) faellig = plusTage(t, 2);
      else if (/\bmorgen\b/.test(f)) faellig = plusTage(t, 1);
      else if (/\bheute\b/.test(f)) faellig = t;
      else if (/\bnachste woche\b|\bnaechste woche\b/.test(f)) faellig = plusTage(t, 7);
      else if (tage) { const n = /^\d+$/.test(tage[1]) ? Number(tage[1]) : ZAHLWORT[tage[1]]; if (n) faellig = plusTage(t, n); }
      else {
        const w = f.match(/\b(?:bis |am )?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b/);
        if (w) { const heuteTag = new Date(`${t}T12:00:00Z`).getUTCDay(); faellig = plusTage(t, ((WOCHENTAG[w[1]] - heuteTag + 7) % 7) || 7); }
      }
      if (faellig) { erkannt.push(`fällig ${faellig.split('-').reverse().join('.')}`); entferne(/\b(übermorgen|uebermorgen|morgen|heute|nächste Woche|naechste Woche|in \S+ Tagen|(?:bis |am )?(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag))\b/gi); }

      // Title: what is left, tidied up; the whole dictation stays in the description.
      let titel = rest.replace(/\s*[,;.]\s*([,;.]\s*)*/g, ', ').replace(/\s+/g, ' ').replace(/^[\s,;.:-]+|[\s,;.:-]+$/g, '').trim();
      if (!titel) titel = roh;
      titel = titel.charAt(0).toUpperCase() + titel.slice(1);
      return {
        titel: titel.slice(0, 200), beschreibung: roh, objekt_id: objekt?.id ?? oid ?? null, einheit_id: einheit?.id ?? null, person_id: person?.id ?? null,
        prioritaet, faellig, erkannt,
      };
    },
  };
};
