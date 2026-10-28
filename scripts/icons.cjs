// Draws the app icons for the browser / home screen (public/): a white house on the orange accent colour.
// Run: node scripts/icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

function icon(groesse, rand) {
  const c = createCanvas(groesse, groesse);
  const g = c.getContext('2d');
  g.fillStyle = '#c4501b';
  if (rand) { g.beginPath(); g.roundRect(0, 0, groesse, groesse, groesse * 0.22); g.fill(); } else g.fillRect(0, 0, groesse, groesse);
  const s = groesse / 24, ox = groesse * 0.5 - 12 * s * 0.62, oy = groesse * 0.5 - 12 * s * 0.62;
  g.save();
  g.translate(ox, oy);
  g.scale(s * 0.62, s * 0.62);
  g.strokeStyle = '#fff'; g.lineWidth = 2.1; g.lineJoin = 'round'; g.lineCap = 'round';
  // lucide "house"
  g.stroke(new (require('@napi-rs/canvas').Path2D)('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'));
  g.stroke(new (require('@napi-rs/canvas').Path2D)('M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'));
  g.restore();
  return c.toBuffer('image/png');
}
const ziel = path.join(__dirname, '..', 'public');
fs.mkdirSync(ziel, { recursive: true });
fs.writeFileSync(path.join(ziel, 'icon-192.png'), icon(192, false));
fs.writeFileSync(path.join(ziel, 'icon-512.png'), icon(512, false));
fs.writeFileSync(path.join(ziel, 'apple-touch-icon.png'), icon(180, false));
fs.writeFileSync(path.join(ziel, 'favicon.png'), icon(64, true));
console.log('Icons geschrieben.');
