import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api/whatsapp': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/api/integrations': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/api/agents':   { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/api/clinica':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/api/data':     { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
});
