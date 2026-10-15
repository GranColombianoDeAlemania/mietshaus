import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: { index: resolve(__dirname, 'index.html'), analyse: resolve(__dirname, 'analyse.html') },
    },
  },
});
