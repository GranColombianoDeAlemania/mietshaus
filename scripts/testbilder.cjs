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
