// Identity of this installation: a random id that stays, and a readable name (user@computer). Kept outside the
// database, because the database may be copied to or shared with another computer; the app and its MCP server read
// the same file, so both stamp changes with the same device.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function geraet(userData) {
  const datei = path.join(userData, 'geraet.json');
  try {
    const g = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (g?.id) return g;
  } catch {}
  let benutzer = 'Benutzer';
  try { benutzer = os.userInfo().username; } catch {}
  const g = { id: crypto.randomUUID(), name: `${benutzer}@${os.hostname().replace(/\.local$/, '')}` };
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(datei, JSON.stringify(g, null, 2));
  } catch {}
  return g;
}

module.exports = { geraet };
