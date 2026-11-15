import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// The version the user interface was built as – shown in the settings beside the server's (a cached older interface
// is seen at once).
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

// In development (npm run dev) the Mac app's embedded server listens on MIETSHAUS_PORT; Vite forwards the server's paths.
const api = `http://127.0.0.1:${process.env.MIETSHAUS_PORT ?? 8790}`;

export default defineConfig({
  plugins: [react()],
  define: { __OBERFLAECHE__: JSON.stringify(version) },
  base: '/',
  server: { proxy: { '/api': api, '/dateien': api, '/lokal': api } },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html') },
    },
  },
});
