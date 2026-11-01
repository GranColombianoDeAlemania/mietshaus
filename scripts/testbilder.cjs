// Creates the test pictures in scripts/testdaten: a photographed receipt and a meter (for OCR, the image smoke test and
// the meter photo). Run once: node scripts/testbilder.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

function bild(datei, b, h, malen) {
  const c = createCanvas(b, h);
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, b, h);
  malen(g);
  fs.writeFileSync(path.join(__dirname, 'testdaten', datei), c.toBuffer('image/png'));
}

bild('beleg.png', 900, 600, (g) => {
  g.fillStyle = '#111';
  g.font = 'bold 44px sans-serif';
  g.fillText('Baumarkt Schmidt GmbH', 60, 110);
  g.font = '34px sans-serif';
  g.fillText('Quittung Nr. 4711', 60, 200);
  g.fillText('Datum: 14.10.2026', 60, 260);
  g.fillText('Silikon und Dichtband', 60, 340);
  g.font = 'bold 40px sans-serif';
  g.fillText('Gesamt 48,90 EUR', 60, 450);
});

// A meter: black rolls with white digits on a grey body, the last digit red like on a water meter.
bild('zaehler.png', 900, 420, (g) => {
  g.fillStyle = '#d9d9d9';
  g.fillRect(0, 0, 900, 420);
  g.fillStyle = '#333';
  g.font = '30px sans-serif';
  g.fillText('m³', 760, 230);
  const ziffern = '04821';
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i < 5 ? '#111' : '#b00';
    g.fillRect(90 + i * 105, 140, 90, 130);
    g.fillStyle = '#fff';
    g.font = 'bold 96px sans-serif';
    g.fillText(i < 5 ? ziffern[i] : '7', 108 + i * 105, 240);
  }
  g.fillStyle = '#333';
  g.font = '24px sans-serif';
  g.fillText('Nr. 19-445566  Qn 2,5', 90, 340);
});

// A craftsman's invoice: letterhead, recipient, items with quantities, net, VAT and the imprint in the foot.
bild('rechnung.png', 1240, 1600, (g) => {
  const zeile = (t, x, y, f = '26px sans-serif') => { g.font = f; g.fillText(t, x, y); };
  const rechts = (t, x, y, f = '26px sans-serif') => { g.font = f; g.fillText(t, x - g.measureText(t).width, y); };
  g.fillStyle = '#111';
  zeile('Müller Haustechnik GmbH', 80, 110, 'bold 46px sans-serif');
  zeile('Müller Haustechnik GmbH · Industriestr. 12 · 80939 München', 80, 230, '20px sans-serif');
  zeile('Hausverwaltung Probe', 80, 280);
  zeile('Gartenweg 3', 80, 318);
  zeile('81675 München', 80, 356);
  zeile('Rechnung Nr. 2026-1187', 80, 470, 'bold 32px sans-serif');
  zeile('Rechnungsdatum: 14.10.2026', 80, 520);
  zeile('Pos.  Bezeichnung', 80, 620, 'bold 26px sans-serif');
  zeile('Menge', 640, 620, 'bold 26px sans-serif');
  rechts('Gesamt', 1160, 620, 'bold 26px sans-serif');
  const posten = [['1', 'Heizungsventil', '1 Stk', '89,00'], ['2', 'Arbeitszeit Geselle', '1,5 Std', '87,00'], ['3', 'Dichtungssatz', '2 Stk', '13,00'], ['4', 'Anfahrt pauschal', '', '25,00']];
  posten.forEach(([n, t, m, b], i) => { zeile(`${n}     ${t}`, 80, 680 + i * 50); zeile(m, 640, 680 + i * 50); rechts(b, 1160, 680 + i * 50); });
  zeile('Summe netto', 640, 940); rechts('214,00', 1160, 940);
  zeile('zzgl. 19 % MwSt', 640, 990); rechts('40,66', 1160, 990);
  zeile('Gesamtbetrag', 640, 1050, 'bold 30px sans-serif'); rechts('254,66 €', 1160, 1050, 'bold 30px sans-serif');
  zeile('Zahlbar bis 28.10.2026 ohne Abzug.', 80, 1160);
  zeile('Müller Haustechnik GmbH | Geschäftsführer: Hans Müller | Amtsgericht München HRB 123456', 80, 1440, '19px sans-serif');
  zeile('USt-IdNr. DE123456789 | Tel. 089 123456-0 | info@mueller-haustechnik.de', 80, 1475, '19px sans-serif');
  zeile('Stadtsparkasse München | IBAN DE02 7015 0000 0000 1234 56 | BIC SSKMDEMMXXX', 80, 1510, '19px sans-serif');
});
