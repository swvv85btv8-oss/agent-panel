import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL ?? 'http://localhost:4100';

export default defineConfig({
  plugins: [react()],
  // The API runs separately; proxying keeps every client fetch origin-relative.
  server: { port: 5273, proxy: { '/api': { target: API, changeOrigin: true } } },
  preview: { port: 5273, proxy: { '/api': { target: API, changeOrigin: true } } },
  build: { outDir: 'dist', sourcemap: true },
});
