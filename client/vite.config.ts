import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: '/daiko/', plugins: [react()], server: { proxy: { '/daiko-api': { target: 'http://localhost:3002', rewrite: path => path.replace(/^\/daiko-api/, '/api') }, '/api/auth': { target: 'https://parcelhub.nekoj.in', changeOrigin: true, secure: true } } } });
