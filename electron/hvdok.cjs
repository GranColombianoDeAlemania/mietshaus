// hvdok://dokument/<file> and hvdok://vorschau/<file>: stored documents and previews for the windows of the test scripts.
// CORS is allowed because pages load from http:// (dev) or file://.
const { protocol, net } = require('electron');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

function protokollRegistrieren(dokumentOrdner, vorschauOrdner) {
  protocol.handle('hvdok', async (req) => {
    const u = new URL(req.url);
    const ordner = u.hostname === 'vorschau' ? vorschauOrdner() : dokumentOrdner();
    const r = await net.fetch(pathToFileURL(path.join(ordner, path.basename(decodeURIComponent(u.pathname)))).href);
    const headers = new Headers(r.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(r.body, { status: r.status, headers });
  });
}

module.exports = { protokollRegistrieren, SCHEMA: { scheme: 'hvdok', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } } };
