// Starts the Vite dev server, then Electron pointed at it; the app's embedded server takes a fixed port Vite forwards to.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

process.env.MIETSHAUS_PORT ??= '8790';
const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url, MIETSHAUS_PORT: process.env.MIETSHAUS_PORT } });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
