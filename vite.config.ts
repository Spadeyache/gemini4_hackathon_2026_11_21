import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { brandIngestVitePlugin } from './server/brandIngestPlugin';
import { gemini4DecisionsVitePlugin } from './server/gemini4DecisionsPlugin';
import { shopifyCommerceVitePlugin } from './server/shopifyCommercePlugin';
import { studioRenderVitePlugin } from './server/studioRenderPlugin';

export default defineConfig({
  plugins: [
    react(),
    brandIngestVitePlugin(),
    gemini4DecisionsVitePlugin(),
    shopifyCommerceVitePlugin(),
    studioRenderVitePlugin(),
  ],
  server: {
    port: 5173,
    host: true,
  },
});
