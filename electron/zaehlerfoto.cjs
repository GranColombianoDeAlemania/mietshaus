// Meter reading from a photo: candidates from the recognised lines of digits. The counter is the largest text on a
// meter; with the last reading the candidates are checked (not smaller, not absurdly larger) and the closest comes first.
// Only a proposal – the reading dialog shows the photo and the value has to be confirmed.

// zeilen: [{ text, hoehe }] as read by analyse.ziffernLesen; letzter: last reading or null.
function kandidaten(zeilen, letzter = null) {
  const werte = new Map();
  const add = (wert, hoehe, text) => {
    const k = String(wert);
    if (!werte.has(k) || werte.get(k).hoehe < hoehe) werte.set(k, { wert, hoehe, text });
  };
  for (const z of zeilen) {
    const t = String(z.text ?? '').replace(/[^\d,. ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // Rolls read one by one come with spaces ("4 8 2 1 7"): joined and as single groups.
    for (const v of new Set([t.replace(/ /g, ''), ...t.split(' ')])) {
      const m = /^(\d{3,9})(?:[,.](\d{1,3}))?$/.exec(v);
      if (!m) continue;
      add(m[2] ? Number(`${m[1]}.${m[2]}`) : Number(m[1]), z.hoehe, v);
      // Water and gas meters show the decimals on red rolls without a separator: the last one or two digits may be decimals.
      if (!m[2] && m[1].length >= 5) {
        add(Number(m[1]) / 10, z.hoehe * 0.99, v);
        add(Number(m[1]) / 100, z.hoehe * 0.98, v);
      }
    }
  }
  let liste = [...werte.values()];
  if (letzter != null && Number.isFinite(Number(letzter))) {
    const l = Number(letzter);
    liste = liste.filter((k) => k.wert >= l && k.wert <= l * 3 + 100_000).sort((a, b) => a.wert - b.wert);
  } else liste.sort((a, b) => b.hoehe - a.hoehe || b.text.length - a.text.length);
  return liste.slice(0, 5).map((k) => k.wert);
}

module.exports = { kandidaten };
