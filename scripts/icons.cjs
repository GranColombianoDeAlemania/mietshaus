// Draws the logo and the app icons from resources/jago.jpg (a square cut of a photo of Jago, the mascot): his face in a
// round frame under a small roof, as resources/logo.svg (photo embedded, frame and roof as vectors), and public/jago.jpg
// for Jago's button and window. Then the icons:
//   public/  – browser tab, iPhone/iPad home screen, web app (square; the systems round the corners themselves)
//   resources/Mietshaus.icns – the Mac app (rounded square with the margin macOS expects)
// Run on a Mac: node scripts/icons.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const wurzel = path.join(__dirname, '..');

// The logo: cream rounded square, Jago in a ring (centre 512/560), the roof above it.
function logoSvg(foto) {
  const bild = `data:image/jpeg;base64,${foto.toString('base64')}`;
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024">'
    + '<defs><clipPath id="rund"><circle cx="512" cy="560" r="360"/></clipPath></defs>'
    + '<rect width="1024" height="1024" rx="228" fill="#f6e4c6"/>'
    + '<circle cx="512" cy="560" r="386" fill="#fffaf0" stroke="#1f1c19" stroke-width="14"/>'
    + `<image href="${bild}" xlink:href="${bild}" x="152" y="200" width="720" height="720" clip-path="url(#rund)"/>`
    + '<path d="M150 250 L512 52 L874 250 L820 300 L512 132 L204 300 Z" fill="#ea6a38" stroke="#1f1c19" stroke-width="16" stroke-linejoin="round"/>'
    + '</svg>\n';
}
let svg;

(async () => {
  // A smaller copy of the photo for the logo and for Jago in the app.
  const jago = await loadImage(fs.readFileSync(path.join(wurzel, 'resources', 'jago.jpg')));
  const verkleinert = (g, qualitaet) => { const c = createCanvas(g, g); c.getContext('2d').drawImage(jago, 0, 0, g, g); return c.toBuffer('image/jpeg', qualitaet); };
  svg = logoSvg(verkleinert(400, 82));
  fs.writeFileSync(path.join(wurzel, 'resources', 'logo.svg'), svg);
  fs.writeFileSync(path.join(wurzel, 'public', 'jago.jpg'), verkleinert(256, 85));
  // The same logo drawn on a canvas for the PNG icons (the SVG renderer here leaves out embedded photos).
  // eckig: without the rounded corners, for systems that round by themselves; rand: margin (macOS).
  const bild = async (eckig, groesse, rand = 0) => {
    const c = createCanvas(groesse, groesse);
    const x = c.getContext('2d');
    const k = (groesse - 2 * rand) / 1024;
    x.translate(rand, rand);
    x.scale(k, k);
    x.fillStyle = '#f6e4c6';
    x.beginPath(); x.roundRect(0, 0, 1024, 1024, eckig ? 0 : 228); x.fill();
    x.fillStyle = '#fffaf0'; x.strokeStyle = '#1f1c19'; x.lineWidth = 14;
    x.beginPath(); x.arc(512, 560, 386, 0, 2 * Math.PI); x.fill(); x.stroke();
    x.save(); x.beginPath(); x.arc(512, 560, 360, 0, 2 * Math.PI); x.clip(); x.drawImage(jago, 152, 200, 720, 720); x.restore();
    x.fillStyle = '#ea6a38'; x.lineWidth = 16; x.lineJoin = 'round';
    x.beginPath(); x.moveTo(150, 250); x.lineTo(512, 52); x.lineTo(874, 250); x.lineTo(820, 300); x.lineTo(512, 132); x.lineTo(204, 300); x.closePath();
    x.fill(); x.stroke();
    return c.toBuffer('image/png');
  };
  const pub = path.join(wurzel, 'public');
  fs.writeFileSync(path.join(pub, 'icon-192.png'), await bild(true, 192));
  fs.writeFileSync(path.join(pub, 'icon-512.png'), await bild(true, 512));
  fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), await bild(true, 180));
  fs.writeFileSync(path.join(pub, 'favicon.png'), await bild(false, 64));
  fs.copyFileSync(path.join(wurzel, 'resources', 'logo.svg'), path.join(pub, 'logo.svg'));
  // macOS: the icon shape is 824 of 1024 points, centred.
  if (process.platform === 'darwin') {
    const set = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-icon-')) + '/Mietshaus.iconset';
    fs.mkdirSync(set);
    for (const g of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(path.join(set, `icon_${g}x${g}.png`), await bild(false, g, Math.round(g * 100 / 1024)));
      fs.writeFileSync(path.join(set, `icon_${g}x${g}@2x.png`), await bild(false, g * 2, Math.round(g * 2 * 100 / 1024)));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(wurzel, 'resources', 'Mietshaus.icns')]);
  }
  console.log('Icons geschrieben.');
})();
