import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Connect } from 'vite';
import { authPolicy, authProxyRoutes } from './dev/auth-proxy';
import react from '@vitejs/plugin-react';
function guardAuth(daikoPort: number): Connect.NextHandleFunction {
  return (request, response, next) => {
    const policy = authPolicy(request.url?.split('?')[0] || '', request.method, request.headers.origin, daikoPort);
    if (policy.corsOrigin) {
      response.setHeader('Access-Control-Allow-Origin', policy.corsOrigin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.setHeader('Vary', 'Origin');
    }
    if (policy.status !== null) {
      response.writeHead(policy.status);
      response.end();
      return;
    }
    next();
  };
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '');
  const parcelHub = process.env.PARCELHUB_URL || rootEnv.PARCELHUB_URL || 'http://localhost:3001';
  const base = process.env.VITE_BASE_PATH || rootEnv.VITE_BASE_PATH || '/';
  return {
    base,
    plugins: [react(), {
      name: 'daiko-local-routes',
      configurePreviewServer(server) {
        server.middlewares.use(guardAuth(server.config.preview.port ?? 4173));
      },
      configureServer(server) {
        server.middlewares.use(guardAuth(server.config.server.port ?? 5174));
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
        [authProxyRoutes]: { target: parcelHub, changeOrigin: true, secure: true, configure(proxy) {
          proxy.on('proxyRes', proxyResponse => {
            delete proxyResponse.headers['access-control-allow-origin'];
            delete proxyResponse.headers['access-control-allow-credentials'];
          });
        } },
      },
    },
  };
});
