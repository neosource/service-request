'use strict';

require('dotenv').config();

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
  mongoUri:
    process.env.MONGO_URI ||
    'mongodb://localhost:27017/service_requests',
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID || '',
    clientId: process.env.ENTRA_CLIENT_ID || '',
    audience: process.env.ENTRA_AUDIENCE || '',
  },
  disableAuth: String(process.env.DISABLE_AUTH || '').toLowerCase() === 'true',
};

module.exports = config;
