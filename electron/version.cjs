// Versions and updates: comparing version numbers and asking GitHub for the newest release. Used by the server (hint
// in the app) and by the Mac app (updates itself). Only the public releases API, no token.
const paket = require('../package.json');

const VERSION = paket.version;
const REPO = paket.mietshaus?.github;
// Raised when the Mac app's part (preload, desktop.cjs) changes in a way an older app cannot follow.
const DESKTOP_SCHNITTSTELLE = paket.mietshaus?.desktopSchnittstelle ?? 1;

const teile = (v) => String(v ?? '').replace(/^v/, '').split(/[.-]/).slice(0, 3).map((x) => Number.parseInt(x, 10) || 0);
// > 0 when a is newer than b.
function vergleichen(a, b) {
  const x = teile(a), y = teile(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Newest release on GitHub: { version, url, notizen, dateien: { name: download-url } } or null (no network, none yet).
// quelle: another address for the release data (tests).
async function neuesteVersion({ quelle = process.env.MIETSHAUS_UPDATE_QUELLE, fetchen = fetch } = {}) {
  const url = quelle ?? (REPO ? `https://api.github.com/repos/${REPO}/releases/latest` : null);
  if (!url) return null;
  try {
    const r = await fetchen(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Mietshaus/${VERSION}` }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    const j = await r.json();
    return { version: String(j.tag_name ?? '').replace(/^v/, ''), url: j.html_url, notizen: String(j.body ?? '').slice(0, 4000),
      dateien: Object.fromEntries((j.assets ?? []).map((a) => [a.name, a.browser_download_url])) };
  } catch {
    return null;
  }
}

module.exports = { VERSION, REPO, DESKTOP_SCHNITTSTELLE, vergleichen, neuesteVersion };
