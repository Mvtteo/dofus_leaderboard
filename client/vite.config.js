import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Bare '/admin' is NOT proxied: in dev it must load Vite's own SPA shell
      // (main.jsx picks AdminApp client-side based on pathname). Only the
      // backend endpoints under it are forwarded.
      '/api': 'http://localhost:3000',
      '/admin/api': 'http://localhost:3000',
      '/admin/login': 'http://localhost:3000',
      '/admin/logout': 'http://localhost:3000',
      '/web': 'http://localhost:3000',
      '/assets': 'http://localhost:3000',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
