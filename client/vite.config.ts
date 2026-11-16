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
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/api/auth/sign-in/email') return next();
          const origin = request.headers.origin;
          const allowed = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'];
          if (origin && !allowed.includes(origin)) { response.writeHead(403); response.end(); return; }
          if (origin) {
            response.setHeader('Access-Control-Allow-Origin', origin);
            response.setHeader('Access-Control-Allow-Credentials', 'true');
            response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            response.setHeader('Vary', 'Origin');
          }
          if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
          next();
        });
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
      host: 'localhost', port: 5174, strictPort: true, cors: false,
      proxy: {
        '/daiko-api': { target: 'http://localhost:3002', rewrite: path => path.replace(/^\/daiko-api/, '/api') },
        '/api/auth': { target: parcelHub, changeOrigin: true, secure: true, configure(proxy) {
          proxy.on('proxyRes', (proxyResponse, request) => {
            if (request.url?.split('?')[0] !== '/api/auth/sign-in/email') return;
            delete proxyResponse.headers['access-control-allow-origin'];
            delete proxyResponse.headers['access-control-allow-credentials'];
          });
        } },
      },
    },
  };
});
