'use strict';

const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Connect to MongoDB and ensure required indexes exist.
 * Safe to call multiple times — returns the same db instance.
 */
async function connect(uri) {
  if (db) return db;

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  db = client.db();

  // Ensure indexes
  await db.collection('serviceRequests').createIndexes([
    { key: { caseNumber: 1 }, unique: true, name: 'uniq_caseNumber' },
    { key: { createdAt: -1 }, name: 'recent_first' },
    { key: { 'customer.phone': 1 }, name: 'by_phone' },
  ]);

  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB not connected. Call connect() first.');
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

module.exports = { connect, getDb, close };
