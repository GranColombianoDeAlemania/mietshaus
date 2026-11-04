// The calendar as an iCalendar feed (RFC 5545) for the calendar apps on iPhone and Mac: whole-day entries for deadlines,
// timed ones for appointments. No amounts and no tenant names – a subscribed calendar may be copied into a cloud.
const crypto = require('node:crypto');

const text = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`);
// Lines longer than 75 bytes are folded (a space at the start of the next line continues it).
function falten(zeile) {
  const teile = [];
  let rest = Buffer.from(zeile, 'utf8');
  while (rest.length > 75) {
    let n = teile.length ? 74 : 75;
    while ((rest[n] & 0xc0) === 0x80) n--; // never cut a UTF-8 character
    teile.push(rest.subarray(0, n).toString('utf8'));
    rest = rest.subarray(n);
  }
  teile.push(rest.toString('utf8'));
  return teile.join('\r\n ');
}
const tag = (iso) => iso.replaceAll('-', '');
const naechsterTag = (iso) => new Date(Date.parse(`${iso}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
const ARTEN = { termin: 'Termin', frist: 'Frist', vorgang: 'Vorgang', projekt: 'Projekt', umzug: 'Ein-/Auszug' };

// RFC 5545 wants the definition of every TZID used; strict clients otherwise read the times as UTC.
const ZEITZONE = ['BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE'];

function ics(eintraege, { name = 'Mietshaus', jetzt = new Date() } = {}) {
  const stempel = jetzt.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mietshaus//Kalender//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${text(name)}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H', ...ZEITZONE];
  for (const e of eintraege) {
    // Amounts in brackets („Grundsteuer (462,00 €)“) stay in the app.
    const titel = (e.kurz ?? e.titel).replace(/\s*\([^)]*€[^)]*\)/g, '');
    const uid = crypto.createHash('sha1').update(`${e.art}|${e.termin_id ?? ''}|${e.datum}|${titel}`).digest('hex');
    zeilen.push('BEGIN:VEVENT', `UID:${uid}@mietshaus`, `DTSTAMP:${stempel}`);
    const zeit = /^(\d{1,2}):(\d{2})/.exec(e.uhrzeit ?? '');
    if (zeit) {
      const beginn = new Date(Date.UTC(2000, 0, 1, Number(zeit[1]), Number(zeit[2]) + (e.dauer_min || 60)));
      const ende = `${String(beginn.getUTCHours()).padStart(2, '0')}${String(beginn.getUTCMinutes()).padStart(2, '0')}00`;
      // Past midnight the entry simply ends at 23:59.
      const ueber = Number(zeit[1]) * 60 + Number(zeit[2]) + (e.dauer_min || 60) >= 24 * 60;
      zeilen.push(`DTSTART;TZID=Europe/Berlin:${tag(e.datum)}T${zeit[1].padStart(2, '0')}${zeit[2]}00`,
        `DTEND;TZID=Europe/Berlin:${tag(e.datum)}T${ueber ? '235900' : ende}`);
    } else {
      zeilen.push(`DTSTART;VALUE=DATE:${tag(e.datum)}`, `DTEND;VALUE=DATE:${tag(naechsterTag(e.datum))}`, 'TRANSP:TRANSPARENT');
    }
    zeilen.push(`SUMMARY:${text(`${e.wichtig ? '❗ ' : ''}${titel}`)}`, `CATEGORIES:${text(ARTEN[e.art] ?? e.art)}`);
    if (e.objekt || e.ort) zeilen.push(`LOCATION:${text([e.ort, e.objekt].filter(Boolean).join(', '))}`);
    zeilen.push('END:VEVENT');
  }
  zeilen.push('END:VCALENDAR');
  return zeilen.map(falten).join('\r\n') + '\r\n';
}

module.exports = { ics };
