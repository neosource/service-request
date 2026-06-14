'use strict';

require('dotenv').config();

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`${name} must be set`);
  }
  return String(value).trim();
}

function parseCorsOrigins(value) {
  if (!value) {
    return ['http://localhost:3000', 'http://localhost:8080'];
  }
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGIN),
  mongoUri: requiredEnv('MONGO_URI'),
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID || '',
    clientId: process.env.ENTRA_CLIENT_ID || '',
    audience: process.env.ENTRA_AUDIENCE || '',
  },
  disableAuth: String(process.env.DISABLE_AUTH || '').toLowerCase() === 'true',
};

module.exports = config;
