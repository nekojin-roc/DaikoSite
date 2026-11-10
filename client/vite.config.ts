import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  const parcelHub = process.env.PARCELHUB_URL || rootEnv.PARCELHUB_URL || 'http://localhost:3001';
  const base = process.env.VITE_BASE_PATH || rootEnv.VITE_BASE_PATH || '/';
  return {
    base,
    plugins: [react(), {
      name: 'redirect-legacy-daiko-path',
      configureServer(server) {
        if (base !== '/') return;
        server.middlewares.use((request, response, next) => {
          const url = new URL(request.url || '/', 'http://localhost');
          if ((request.method === 'GET' || request.method === 'HEAD') && /^\/daiko(?:\/|$)/.test(url.pathname)) {
            const path = url.pathname.replace(/^\/daiko(?:\/|$)/, '/').replace(/^\/\/+/, '/');
            response.writeHead(308, { Location: path + url.search });
            response.end();
            return;
          }
          next();
        });
      },
    }],
    server: {
      host: 'localhost', port: 5174, strictPort: true,
      proxy: {
        '/daiko-api': { target: 'http://localhost:3002', rewrite: path => path.replace(/^\/daiko-api/, '/api') },
        '/api/auth': { target: parcelHub, changeOrigin: true, secure: true },
      },
    },
  };
});
