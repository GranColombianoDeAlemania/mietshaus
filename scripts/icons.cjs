// Draws the app icons from resources/logo.svg (house with a capybara in the door):
//   public/  – browser tab, iPhone/iPad home screen, web app (square; the systems round the corners themselves)
//   resources/Mietshaus.icns – the Mac app (rounded square with the margin macOS expects)
// Run on a Mac: node scripts/icons.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const wurzel = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(wurzel, 'resources', 'logo.svg'), 'utf8');
// Square variant without the rounded corners, for systems that round by themselves.
const eckig = svg.replace('<rect width="1024" height="1024" rx="228"', '<rect width="1024" height="1024" rx="0"');

(async () => {
  const bild = async (quelle, groesse, rand = 0) => {
    const img = await loadImage(Buffer.from(quelle));
    const c = createCanvas(groesse, groesse);
    c.getContext('2d').drawImage(img, rand, rand, groesse - 2 * rand, groesse - 2 * rand);
    return c.toBuffer('image/png');
  };
  const pub = path.join(wurzel, 'public');
  fs.writeFileSync(path.join(pub, 'icon-192.png'), await bild(eckig, 192));
  fs.writeFileSync(path.join(pub, 'icon-512.png'), await bild(eckig, 512));
  fs.writeFileSync(path.join(pub, 'apple-touch-icon.png'), await bild(eckig, 180));
  fs.writeFileSync(path.join(pub, 'favicon.png'), await bild(svg, 64));
  fs.copyFileSync(path.join(wurzel, 'resources', 'logo.svg'), path.join(pub, 'logo.svg'));
  // macOS: the icon shape is 824 of 1024 points, centred.
  if (process.platform === 'darwin') {
    const set = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-icon-')) + '/Mietshaus.iconset';
    fs.mkdirSync(set);
    for (const g of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(path.join(set, `icon_${g}x${g}.png`), await bild(svg, g, Math.round(g * 100 / 1024)));
      fs.writeFileSync(path.join(set, `icon_${g}x${g}@2x.png`), await bild(svg, g * 2, Math.round(g * 2 * 100 / 1024)));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(wurzel, 'resources', 'Mietshaus.icns')]);
  }
  console.log('Icons geschrieben.');
})();
