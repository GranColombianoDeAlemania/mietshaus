// Street and house number are entered in two fields but stored together in one column ("Musterstraße 12a"), so letters,
// e-invoices, exports and Claude keep using a single address line.
const NR = /^(.*\S)\s+(\d+\s*[a-zA-Z]?(?:\s*[-–/]\s*\d*\s*[a-zA-Z]?)?)$/;

export function strasseTeilen(s: unknown): [strasse: string, nr: string] {
  const t = String(s ?? '').trim();
  const m = NR.exec(t);
  return m ? [m[1], m[2].replace(/\s+/g, '')] : [t, ''];
}

export const strasseVerbinden = (strasse: unknown, nr: unknown) => [String(strasse ?? '').trim(), String(nr ?? '').trim()].filter(Boolean).join(' ');
