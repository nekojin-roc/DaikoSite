import assert from 'node:assert/strict';
import test from 'node:test';
import { authPolicy, authProxyRoutes } from '../dev/auth-proxy';

const signIn = '/api/auth/sign-in/email';
const signOut = '/api/auth/sign-out';

test('Daiko sign-in and ParcelHub registration work with explicit local origins', () => {
  for (const port of [5174, 4173]) {
    for (const origin of [`http://localhost:${port}`, 'http://127.0.0.1:5173']) {
      assert.deepEqual(authPolicy(signIn, 'OPTIONS', origin, port), { status: 204, corsOrigin: origin });
      assert.deepEqual(authPolicy(signIn, 'POST', origin, port), { status: null, corsOrigin: origin });
    }
    assert.equal(authPolicy(signOut, 'POST', `http://127.0.0.1:${port}`, port).status, null);
    assert.equal(authPolicy(signOut, 'POST', 'http://localhost:5173', port).status, 403);
    assert.equal(authPolicy(signIn, 'POST', undefined, port).status, 403);
    assert.equal(authPolicy(signIn, 'GET', `http://localhost:${port}`, port).status, 405);
  }
});

test('only the two Daiko auth routes are proxied', () => {
  const match = new RegExp(authProxyRoutes);
  for (const url of [signIn, signOut, signIn + '?from=daiko']) assert.ok(match.test(url));
  for (const url of ['/api/auth', '/api/auth/sign-up/email', '/api/auth/sign-out/extra']) {
    assert.equal(match.test(url), false);
    assert.equal(authPolicy(url, 'POST', 'http://localhost:5174', 5174).status, 404);
  }
});
