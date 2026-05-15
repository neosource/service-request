'use strict';

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

/**
 * Build a JWT verifier that validates Entra ID (Azure AD) tokens.
 * Returns an async function: verifyToken(token) -> claims.
 *
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.audience    expected 'aud' claim
 */
function createEntraVerifier({ tenantId, audience }) {
  const issuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ];
  const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

  const client = jwksClient({
    jwksUri,
    cache: true,
    cacheMaxAge: 10 * 60 * 1000,
    rateLimit: true,
  });

  function getKey(header, callback) {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key.getPublicKey());
    });
  }

  return function verifyToken(token) {
    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        getKey,
        {
          audience,
          issuer: issuers,
          algorithms: ['RS256'],
        },
        (err, claims) => {
          if (err) return reject(err);
          resolve(claims);
        }
      );
    });
  };
}

/**
 * Express middleware factory.
 * Pass a verifier (e.g. createEntraVerifier(...)) OR set { disabled: true }
 * to bypass auth (dev/test only).
 */
function authMiddleware({ verifier, disabled = false } = {}) {
  return async function (req, res, next) {
    if (disabled) {
      req.user = {
        oid: 'dev-oid',
        username: 'dev@local',
        name: 'Dev User',
      };
      return next();
    }
    if (!verifier) {
      return res.status(500).json({ error: 'auth_misconfigured' });
    }

    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }
    try {
      const claims = await verifier(m[1]);
      req.user = {
        oid: claims.oid || claims.sub,
        username:
          claims.preferred_username || claims.upn || claims.email || 'unknown',
        name: claims.name || claims.preferred_username || 'unknown',
      };
      return next();
    } catch (err) {
      return res
        .status(401)
        .json({ error: 'invalid_token', detail: err.message });
    }
  };
}

module.exports = { createEntraVerifier, authMiddleware };
