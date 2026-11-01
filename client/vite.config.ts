import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В dev-режиме проксируем /ws на Rust-сервер, чтобы адрес был одинаковым и в dev, и в проде.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    proxy: { '/ws': { target: 'ws://localhost:3001', ws: true } },
  },
});
