'use strict';

const config = require('./config');
const db = require('./db');
const { buildApp } = require('./app');
const { createEntraVerifier } = require('./auth');
const { createTeamsChatCreator, createTeamsGraphStartupCheck } = require('./teamsApi');

async function main() {
  // eslint-disable-next-line no-console
  console.log('[startup] connecting to mongo:', config.mongoUri.replace(/\/\/[^@]+@/, '//***:***@'));
  await db.connect(config.mongoUri);

  let auth;
  if (config.disableAuth) {
    // eslint-disable-next-line no-console
    console.warn('[startup] AUTH DISABLED — dev mode');
    auth = { disabled: true };
  } else {
    if (!config.entra.tenantId || !config.entra.audience) {
      throw new Error(
        'ENTRA_TENANT_ID and ENTRA_AUDIENCE must be set (or set DISABLE_AUTH=true for dev)'
      );
    }
    auth = {
      verifier: createEntraVerifier({
        tenantId: config.entra.tenantId,
        audience: config.entra.audience,
      }),
    };
  }

  const runTeamsGraphStartupCheck = createTeamsGraphStartupCheck(config.teams);
  if (typeof runTeamsGraphStartupCheck === 'function') {
    await runTeamsGraphStartupCheck();
  }

  const app = buildApp({
    getDb: db.getDb,
    supportTeamsContact: config.supportTeamsContact,
    createTeamsChat: createTeamsChatCreator(config.teams),
    corsOrigins: config.corsOrigins,
    entra: {
      tenantId: config.entra.tenantId,
      audience: config.entra.audience,
    },
    auth,
  });

  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[startup] API listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[fatal]', err);
  process.exit(1);
});
