'use strict';

const request = require('supertest');
const { MongoClient } = require('mongodb');

const { buildApp } = require('../src/app');

let mongod, client, db, app;

beforeAll(async () => {
  // Prefer an externally provided MongoDB (CI, dev machine).
  // Fall back to mongodb-memory-server, which downloads a Mongo binary on
  // first use.
  let uri = process.env.MONGO_TEST_URI;
  if (!uri) {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }
  client = new MongoClient(uri);
  await client.connect();
  db = client.db('service_requests_test');

  // Indexes — mirror what the runtime db module does
  await db.collection('serviceRequests').createIndexes([
    { key: { caseNumber: 1 }, unique: true, name: 'uniq_caseNumber' },
    { key: { createdAt: -1 }, name: 'recent_first' },
  ]);

  app = buildApp({
    getDb: () => db,
    corsOrigins: ['http://localhost'],
    auth: { disabled: true },
  });
});

afterAll(async () => {
  if (client) await client.close();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await db.collection('serviceRequests').deleteMany({});
  await db.collection('counters').deleteMany({});
});

const validPayload = () => ({
  equipment: {
    serialNumber: 'SN-001',
    productModel: 'AX-200',
    issueDescription: 'No power',
  },
  customer: {
    name: 'Jane Doe',
    phone: '+1-555-010-0100',
  },
});

describe('GET /api/health', () => {
  test('returns ok without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/config', () => {
  test('exposes runtime auth configuration', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.authDisabled).toBe(true);
    expect(res.body.auth.disabled).toBe(true);
  });
});

describe('POST /api/cases', () => {
  test('creates a case and returns case number + teams url', async () => {
    const res = await request(app).post('/api/cases').send(validPayload());
    expect(res.status).toBe(201);
    expect(res.body.caseNumber).toMatch(/^SR-\d{8}-\d{5}$/);
    expect(res.body.status).toBe('open');
    expect(res.body.customer.name).toBe('Jane Doe');
    expect(res.body.createdBy.username).toBe('dev@local');
    expect(res.body.teamsChatUrl).toContain('serviceapi-uat.glory-global.com');
    expect(res.body.teamsChatUrl).toContain(res.body.caseNumber);

    const stored = await db
      .collection('serviceRequests')
      .findOne({ caseNumber: res.body.caseNumber });
    expect(stored).not.toBeNull();
    expect(stored.equipment.serialNumber).toBe('SN-001');
  });

  test('rejects invalid payload with 400', async () => {
    const res = await request(app).post('/api/cases').send({ equipment: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  test('generates monotonically increasing case numbers in the same day', async () => {
    const r1 = await request(app).post('/api/cases').send(validPayload());
    const r2 = await request(app).post('/api/cases').send(validPayload());
    const r3 = await request(app).post('/api/cases').send(validPayload());

    expect(r1.body.caseNumber).not.toBe(r2.body.caseNumber);
    expect(r2.body.caseNumber).not.toBe(r3.body.caseNumber);

    const seqOf = (n) => parseInt(n.split('-').pop(), 10);
    expect(seqOf(r2.body.caseNumber)).toBe(seqOf(r1.body.caseNumber) + 1);
    expect(seqOf(r3.body.caseNumber)).toBe(seqOf(r2.body.caseNumber) + 1);
  });

  test('case numbers stay unique under concurrent creation', async () => {
    const reqs = Array.from({ length: 10 }, () =>
      request(app).post('/api/cases').send(validPayload())
    );
    const results = await Promise.all(reqs);
    const numbers = results.map((r) => r.body.caseNumber);
    expect(new Set(numbers).size).toBe(10);
  });
});

describe('GET /api/cases', () => {
  test('lists cases newest-first with pagination metadata', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/cases').send(validPayload());
    }
    const res = await request(app).get('/api/cases?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.length).toBe(2);
    expect(res.body.limit).toBe(2);

    // Newest first by createdAt. Case number is a tie-breaker when timestamps match.
    const seq = (n) => parseInt(n.split('-').pop(), 10);
    const t0 = Date.parse(res.body.items[0].createdAt);
    const t1 = Date.parse(res.body.items[1].createdAt);
    expect(t0).toBeGreaterThanOrEqual(t1);
    if (t0 === t1) {
      expect(seq(res.body.items[0].caseNumber)).toBeGreaterThan(
        seq(res.body.items[1].caseNumber)
      );
    }
  });

  test('caps limit at 100', async () => {
    const res = await request(app).get('/api/cases?limit=999');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
  });
});

describe('GET /api/cases/:caseNumber', () => {
  test('returns one case with a teams chat url', async () => {
    const created = await request(app).post('/api/cases').send(validPayload());
    const num = created.body.caseNumber;

    const res = await request(app).get(`/api/cases/${num}`);
    expect(res.status).toBe(200);
    expect(res.body.caseNumber).toBe(num);
    expect(res.body.teamsChatUrl).toContain(num);
  });

  test('404 when not found', async () => {
    const res = await request(app).get('/api/cases/SR-20990101-99999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });
});

describe('PATCH /api/cases/:caseNumber', () => {
  test('updates status', async () => {
    const created = await request(app).post('/api/cases').send(validPayload());
    const num = created.body.caseNumber;

    const res = await request(app)
      .patch(`/api/cases/${num}`)
      .send({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_progress');
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(res.body.createdAt).getTime()
    );
  });

  test('rejects invalid status', async () => {
    const created = await request(app).post('/api/cases').send(validPayload());
    const num = created.body.caseNumber;
    const res = await request(app)
      .patch(`/api/cases/${num}`)
      .send({ status: 'banana' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_status');
  });

  test('400 when no updatable fields are provided', async () => {
    const created = await request(app).post('/api/cases').send(validPayload());
    const num = created.body.caseNumber;
    const res = await request(app).patch(`/api/cases/${num}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_updatable_fields');
  });
});
