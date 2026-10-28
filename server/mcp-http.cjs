// Claude's tools on the Mietshaus server: MCP over Streamable HTTP under /mcp, stateless (a fresh MCP server per request,
// as the SDK recommends without sessions). The caller is authenticated by the user's Claude token (server.cjs); the
// database proxy marks every change as Claude's, for that user.
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { mcpServer } = require('../electron/mcpWerkzeuge.cjs');

const lesen = (req) => new Promise((ok, nein) => {
  const teile = [];
  req.on('data', (c) => teile.push(c));
  req.on('end', () => { try { ok(teile.length ? JSON.parse(Buffer.concat(teile).toString('utf8')) : undefined); } catch (e) { nein(e); } });
  req.on('error', nein);
});

async function bearbeiten(req, res, db, { dokumente, aktualisiert }) {
  if (req.method !== 'POST') {
    // Without sessions there is no stream to open or end.
    res.writeHead(405, { Allow: 'POST' });
    return res.end();
  }
  const body = await lesen(req);
  const server = mcpServer(db, { dokumente });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); aktualisiert?.(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

module.exports = { bearbeiten };
