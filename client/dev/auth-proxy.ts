// Only these ParcelHub operations are used by Daiko. Keep dev and preview
// aligned with the production Nginx routes, including registration handoff.
export const authProxyRoutes = '^/api/auth/(?:sign-in/email|sign-out)(?:\\?|$)';

export function authPolicy(path: string, method: string | undefined, origin: string | undefined, daikoPort: number) {
  if (path !== '/api/auth' && !path.startsWith('/api/auth/')) return { status: null };
  const signIn = path === '/api/auth/sign-in/email';
  if (!signIn && path !== '/api/auth/sign-out') return { status: 404 };

  const localOrigin = (port: number) => origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
  if (!localOrigin(daikoPort) && !(signIn && localOrigin(5173))) return { status: 403 };
  if (method === 'POST') return { status: null, corsOrigin: signIn ? origin : undefined };
  if (signIn && method === 'OPTIONS') return { status: 204, corsOrigin: origin };
  return { status: 405 };
}
