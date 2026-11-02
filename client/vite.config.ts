import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  const parcelHub = process.env.PARCELHUB_URL || rootEnv.PARCELHUB_URL || 'http://localhost:3001';
  return {
    base: '/daiko/',
    plugins: [react()],
    server: {
      host: 'localhost', port: 5174, strictPort: true,
      proxy: {
        '/daiko-api': { target: 'http://localhost:3002', rewrite: path => path.replace(/^\/daiko-api/, '/api') },
        '/api/auth': { target: parcelHub, changeOrigin: true, secure: true },
      },
    },
  };
});
