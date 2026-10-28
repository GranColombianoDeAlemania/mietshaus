// Calendar dates in the computer's local time. toISOString() would give the UTC date, which in Germany is still
// "yesterday" until 1 or 2 a.m. – enough to book a payment of 1 January into the previous year.
const zwei = (n) => String(n).padStart(2, '0');

const lokalDatum = (d = new Date()) => `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
const heute = () => lokalDatum();
const monatJetzt = () => heute().slice(0, 7);
// Today plus n calendar days (negative: back), counted in local days so summer time does not shift it.
const inTagen = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return lokalDatum(d);
};
// Local date and time without offset, e.g. 2026-10-27T20:15:03 (ISO 20022 ISODateTime, file names).
const lokalZeit = (d = new Date()) => `${lokalDatum(d)}T${zwei(d.getHours())}:${zwei(d.getMinutes())}:${zwei(d.getSeconds())}`;

module.exports = { lokalDatum, heute, monatJetzt, inTagen, lokalZeit };
