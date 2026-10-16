// Minimal ZIP writer (deflate), enough for exports such as the tax adviser package. Names are stored as UTF-8.
const zlib = require('node:zlib');

function dosZeit(d) {
  const zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { zeit, datum };
}

// dateien: [{ name: 'Ordner/Datei.pdf', daten: Buffer | string }]
function zip(dateien) {
  const teile = [];
  const verzeichnis = [];
  let offset = 0;
  const { zeit, datum } = dosZeit(new Date());
  const namen = new Set();
  for (const f of dateien) {
    // Unique names: a second "Rechnung.pdf" becomes "Rechnung (2).pdf".
    let name = f.name.replace(/\\/g, '/');
    for (let i = 2; namen.has(name); i++) name = f.name.replace(/(\.[^./]+)?$/, (ext) => ` (${i})${ext ?? ''}`);
    namen.add(name);
    const roh = Buffer.isBuffer(f.daten) ? f.daten : Buffer.from(String(f.daten), 'utf8');
    const gepackt = zlib.deflateRawSync(roh, { level: 9 });
    const crc = zlib.crc32(roh) >>> 0;
    const nameBuf = Buffer.from(name, 'utf8');
    const kopf = Buffer.alloc(30);
    kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt16LE(0x0800, 6); kopf.writeUInt16LE(8, 8);
    kopf.writeUInt16LE(zeit, 10); kopf.writeUInt16LE(datum, 12); kopf.writeUInt32LE(crc, 14);
    kopf.writeUInt32LE(gepackt.length, 18); kopf.writeUInt32LE(roh.length, 22); kopf.writeUInt16LE(nameBuf.length, 26); kopf.writeUInt16LE(0, 28);
    teile.push(kopf, nameBuf, gepackt);
    const zentral = Buffer.alloc(46);
    zentral.writeUInt32LE(0x02014b50, 0); zentral.writeUInt16LE(20, 4); zentral.writeUInt16LE(20, 6); zentral.writeUInt16LE(0x0800, 8);
    zentral.writeUInt16LE(8, 10); zentral.writeUInt16LE(zeit, 12); zentral.writeUInt16LE(datum, 14); zentral.writeUInt32LE(crc, 16);
    zentral.writeUInt32LE(gepackt.length, 20); zentral.writeUInt32LE(roh.length, 24); zentral.writeUInt16LE(nameBuf.length, 28);
    zentral.writeUInt32LE(offset, 42);
    verzeichnis.push(zentral, nameBuf);
    offset += kopf.length + nameBuf.length + gepackt.length;
  }
  const vz = Buffer.concat(verzeichnis);
  const ende = Buffer.alloc(22);
  ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(dateien.length, 8); ende.writeUInt16LE(dateien.length, 10);
  ende.writeUInt32LE(vz.length, 12); ende.writeUInt32LE(offset, 16);
  return Buffer.concat([...teile, vz, ende]);
}

module.exports = { zip };
