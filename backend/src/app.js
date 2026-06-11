'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { buildCasesRouter } = require('./routes.cases');
const { authMiddleware } = require('./auth');

/**
 * Build the Express app.
 *
 * @param {object} deps
 * @param {() => import('mongodb').Db} deps.getDb
 * @param {string[]} deps.corsOrigins
 * @param {object} [deps.auth]
 * @param {Function} [deps.auth.verifier]   token verifier (or null)
 * @param {boolean}  [deps.auth.disabled]   bypass auth (dev/test only)
 * @param {object} [deps.entra]
 * @param {string} [deps.entra.tenantId]
 * @param {string} [deps.entra.audience]
 */
function buildApp({ getDb, corsOrigins, auth = {}, entra = {} }) {
  const app = express();

  const allowList = Array.isArray(corsOrigins) ? corsOrigins : [];

  function isAllowedOrigin(origin) {
    if (allowList.includes(origin)) return true;

    // Convenience for local development when frontend is served from any local port.
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  }

  app.use(
    cors({
      credentials: false,
      origin(origin, callback) {
        // Allow non-browser clients and same-origin requests without Origin.
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`CORS blocked for origin: ${origin}`));
      },
    })
  );
  app.use(express.json({ limit: '1mb' }));

  // Public health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Frontend config — non-secret values the SPA needs at runtime
  // (we deliberately do NOT expose anything sensitive here)
  app.get('/api/config', (req, res) => {
    const authConfig = {
      disabled: Boolean(auth.disabled),
    };

    if (!auth.disabled) {
      authConfig.tenantId = entra.tenantId || '';
      authConfig.audience = entra.audience || '';
      authConfig.apiScope = entra.audience ? `${entra.audience}/access_as_user` : '';
    }

    res.json({
      authDisabled: Boolean(auth.disabled),
      auth: authConfig,
    });
  });

  // Protected case routes
  app.use(
    '/api/cases',
    authMiddleware(auth),
    buildCasesRouter({ getDb })
  );

  // Serve frontend assets from ./public (container/prod) or ../frontend (local dev).
  const publicDir = path.join(__dirname, '..', 'public');
  const repoFrontendDir = path.join(__dirname, '..', '..', 'frontend');
  const staticDir = fs.existsSync(publicDir) ? publicDir : repoFrontendDir;
  app.use(express.static(staticDir));

  // 404 for unknown /api/* paths
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err);
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}

module.exports = { buildApp };
