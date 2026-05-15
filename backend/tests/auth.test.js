'use strict';

const express = require('express');
const request = require('supertest');
const { authMiddleware } = require('../src/auth');

function makeApp(opts) {
  const app = express();
  app.use(authMiddleware(opts));
  app.get('/me', (req, res) => res.json({ user: req.user }));
  return app;
}

describe('authMiddleware', () => {
  test('bypasses auth when disabled=true and sets a dev user', async () => {
    const app = makeApp({ disabled: true });
    const res = await request(app).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe('dev@local');
  });

  test('returns 401 when no Authorization header', async () => {
    const app = makeApp({ verifier: async () => ({}) });
    const res = await request(app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_bearer_token');
  });

  test('returns 401 when verifier throws', async () => {
    const app = makeApp({
      verifier: async () => {
        throw new Error('bad signature');
      },
    });
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(res.body.detail).toBe('bad signature');
  });

  test('attaches req.user from claims on success', async () => {
    const app = makeApp({
      verifier: async () => ({
        oid: 'oid-1',
        preferred_username: 'agent@contoso.com',
        name: 'Agent Smith',
      }),
    });
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Bearer fake.token.here');
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      oid: 'oid-1',
      username: 'agent@contoso.com',
      name: 'Agent Smith',
    });
  });

  test('returns 500 if no verifier and not disabled', async () => {
    const app = makeApp({});
    const res = await request(app)
      .get('/me')
      .set('Authorization', 'Bearer x');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('auth_misconfigured');
  });
});
