// The Mac app updates itself from the GitHub releases, without a paid Apple certificate: it downloads the zip of the
// new version, checks its SHA-256 (published next to it) and its signature, then a small script swaps the app bundle
// once this app has quit, and starts the new one. Files the app downloads itself carry no quarantine flag, so macOS
// opens the new version without asking.
const { app, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const { VERSION, vergleichen, neuesteVersion } = require('./version.cjs');

const ZIP = 'Mietshaus-mac-arm64.zip';

// The .app bundle this process runs from (…/Mietshaus.app/Contents/MacOS/Mietshaus).
const bundle = () => path.resolve(process.execPath, '..', '..', '..');

// Can this installation update itself? Returns null or the reason why not.
function hindernis() {
  if (!app.isPackaged || process.platform !== 'darwin') return 'Nur die installierte Mac-App aktualisiert sich selbst.';
  const b = bundle();
  if (!b.endsWith('.app')) return 'Programmpaket nicht gefunden.';
  if (b.includes('/AppTranslocation/')) return 'Bitte Mietshaus zuerst in den Ordner „Programme“ ziehen und von dort starten.';
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); } catch { return `Keine Schreibrechte für ${path.dirname(b)}.`; }
  return null;
}

// A newer release with a Mac app, or null.
async function pruefen() {
  const n = await neuesteVersion({ fetchen: (u, o) => net.fetch(u, o) });
  if (!n || vergleichen(n.version, VERSION) <= 0 || !n.dateien[ZIP] || !n.dateien[`${ZIP}.sha256`]) return null;
  return { version: n.version, url: n.url, notizen: n.notizen, zip: n.dateien[ZIP], pruefsumme: n.dateien[`${ZIP}.sha256`], hindernis: hindernis() };
}

async function laden(url) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error(`Download fehlgeschlagen (${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

// Downloads, checks and prepares the new version; then quits and lets the script swap and restart. melde(text): progress.
async function installieren(u, melde = () => {}) {
  const grund = hindernis();
  if (grund) throw new Error(grund);
  melde(`Mietshaus ${u.version} wird geladen …`);
  const zip = await laden(u.zip);
  const soll = (await laden(u.pruefsumme)).toString('utf8').trim().split(/\s+/)[0];
  const ist = crypto.createHash('sha256').update(zip).digest('hex');
  if (!soll || soll !== ist) throw new Error('Die Prüfsumme des Downloads stimmt nicht. Das Update wurde nicht installiert.');
  melde('Update wird geprüft …');
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'mietshaus-update-'));
  fs.writeFileSync(path.join(ordner, ZIP), zip);
  execFileSync('/usr/bin/ditto', ['-x', '-k', path.join(ordner, ZIP), ordner]);
  const neu = path.join(ordner, 'Mietshaus.app');
  if (!fs.existsSync(neu)) throw new Error('Im Download fehlt Mietshaus.app.');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', neu]);
  const ziel = bundle();
  const skript = path.join(ordner, 'tauschen.sh');
  // Waits until this app has ended, keeps the old version until the new one is in place, then starts it.
  fs.writeFileSync(skript, `#!/bin/sh
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done
rm -rf "${ziel}.alt"
mv "${ziel}" "${ziel}.alt" && mv "${neu}" "${ziel}" || { [ -d "${ziel}" ] || mv "${ziel}.alt" "${ziel}"; open "${ziel}"; exit 1; }
xattr -dr com.apple.quarantine "${ziel}" 2>/dev/null
open "${ziel}"
rm -rf "${ziel}.alt" "${ordner}"
`, { mode: 0o755 });
  melde('Mietshaus startet neu …');
  spawn('/bin/sh', [skript], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 300);
}

module.exports = { pruefen, installieren, hindernis };
