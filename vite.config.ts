import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { brandIngestVitePlugin } from './server/brandIngestPlugin';

export default defineConfig({
  plugins: [react(), brandIngestVitePlugin()],
  server: {
    port: 5173,
    host: true,
  },
});
