import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// In development (npm run dev) the Mac app's embedded server listens on MIETSHAUS_PORT; Vite forwards the server's paths.
const api = `http://127.0.0.1:${process.env.MIETSHAUS_PORT ?? 8790}`;

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { proxy: { '/api': api, '/dateien': api, '/lokal': api } },
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html') },
    },
  },
});
