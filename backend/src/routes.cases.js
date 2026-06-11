'use strict';

const express = require('express');
const { nextCaseNumber } = require('./caseNumber');
const { validateCreateCase, validateStatus } = require('./validation');
const { buildTeamsChatLink } = require('./teamsLink');

/**
 * Build the cases router.
 * @param {object} deps
 * @param {() => import('mongodb').Db} deps.getDb
 */
function buildCasesRouter({ getDb }) {
  const router = express.Router();

  // POST /api/cases — create a new case
  router.post('/', async (req, res, next) => {
    try {
      const v = validateCreateCase(req.body);
      if (!v.ok) return res.status(400).json({ error: 'validation_failed', details: v.errors });

      const db = getDb();
      const caseNumber = await nextCaseNumber(db);
      const now = new Date();

      const doc = {
        caseNumber,
        status: 'open',
        equipment: v.value.equipment,
        customer: v.value.customer,
        createdBy: req.user,
        createdAt: now,
        updatedAt: now,
      };

      await db.collection('serviceRequests').insertOne(doc);

      res.status(201).json({
        ...doc,
        teamsChatUrl: buildTeamsChatLink({
          upn: req.user.username,
          caseNumber,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/cases — list, newest first, with pagination
  router.get('/', async (req, res, next) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 25, 100);
      const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

      const db = getDb();
      const cursor = db
        .collection('serviceRequests')
        .find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const [items, total] = await Promise.all([
        cursor.toArray(),
        db.collection('serviceRequests').countDocuments({}),
      ]);

      res.json({ items, total, limit, skip });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/cases/:caseNumber
  router.get('/:caseNumber', async (req, res, next) => {
    try {
      const db = getDb();
      const doc = await db
        .collection('serviceRequests')
        .findOne({ caseNumber: req.params.caseNumber });
      if (!doc) return res.status(404).json({ error: 'not_found' });

      res.json({
        ...doc,
        teamsChatUrl: buildTeamsChatLink({
          upn: req.user.username,
          caseNumber: doc.caseNumber,
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/cases/:caseNumber — limited fields (status, notes-like)
  router.patch('/:caseNumber', async (req, res, next) => {
    try {
      const updates = {};
      if (req.body.status !== undefined) {
        if (!validateStatus(req.body.status)) {
          return res.status(400).json({ error: 'invalid_status' });
        }
        updates.status = req.body.status;
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'no_updatable_fields' });
      }
      updates.updatedAt = new Date();

      const db = getDb();
      const result = await db
        .collection('serviceRequests')
        .findOneAndUpdate(
          { caseNumber: req.params.caseNumber },
          { $set: updates },
          { returnDocument: 'after' }
        );

      const doc = result && result.value ? result.value : result;
      if (!doc) return res.status(404).json({ error: 'not_found' });

      res.json(doc);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { buildCasesRouter };
