// MCP server for Claude Desktop: lets Claude work through the document inbox and file the results in Mietshaus.
// Started by Claude Desktop as: Mietshaus (ELECTRON_RUN_AS_NODE=1) electron/mcp.cjs. Talks JSON-RPC over stdin/stdout,
// so nothing else may be printed to stdout.
//   Local mode (MIETSHAUS_DB): opens the database of this Mac directly, tools from mcpWerkzeuge.cjs.
//   Server mode (MIETSHAUS_SERVER + MIETSHAUS_TOKEN): forwards everything to the server's /mcp, where the same tools run
//   with the user's Claude token – Claude Desktop only starts local MCP servers, and the NAS is not on the internet.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

async function weiterleiten(adresse, token) {
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
  const client = new Client({ name: 'mietshaus-weiterleitung', version: require('../package.json').version });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', adresse), { requestInit: { headers: { Authorization: `Bearer ${token}`, 'X-Mietshaus': '1' } } }));
  const server = new Server({ name: 'mietshaus', version: require('../package.json').version },
    { capabilities: { tools: {} }, instructions: client.getInstructions?.() });
  server.setRequestHandler(ListToolsRequestSchema, (req) => client.listTools(req.params));
  server.setRequestHandler(CallToolRequestSchema, (req) => client.callTool(req.params));
  await server.connect(new StdioServerTransport());
}

function lokal() {
  const { open, api } = require('./db.cjs');
  const { geraet: geraetLesen } = require('./geraet.cjs');
  const { mcpServer } = require('./mcpWerkzeuge.cjs');
  // Same locations Electron uses for the app's userData folder.
  const userData = process.env.MIETSHAUS_DATEN || (process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Mietshaus')
    : process.platform === 'win32' ? path.join(process.env.APPDATA ?? os.homedir(), 'Mietshaus')
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Mietshaus'));
  const dbFile = process.env.MIETSHAUS_DB || path.join(userData, 'mietshaus.sqlite');
  if (!fs.existsSync(dbFile)) {
    process.stderr.write(`Mietshaus-Datenbank nicht gefunden: ${dbFile}. Bitte das Programm einmal starten.\n`);
    process.exit(1);
  }
  // The app may replace the database file (restoring a backup): then the next call opens the new file.
  const geraet = geraetLesen(userData);
  let offen = null;
  const aktuelleDb = () => {
    const ino = fs.statSync(dbFile).ino;
    if (!offen || offen.ino !== ino) {
      try { offen?.raw.close(); } catch {}
      const raw = open(dbFile, 'claude', geraet);
      offen = { ino, raw, api: api(raw) };
    }
    return offen.api;
  };
  aktuelleDb();
  const db = new Proxy({}, { get: (_t, k) => aktuelleDb()[k] });
  return mcpServer(db, { dokumente: path.join(userData, 'dokumente') }).connect(new StdioServerTransport());
}

(process.env.MIETSHAUS_SERVER ? weiterleiten(process.env.MIETSHAUS_SERVER, process.env.MIETSHAUS_TOKEN) : lokal())
  .catch((e) => { process.stderr.write(`Mietshaus-MCP: ${e?.message ?? e}\n`); process.exit(1); });
