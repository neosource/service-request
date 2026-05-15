'use strict';

/**
 * Case numbers are of the form SR-YYYYMMDD-NNNNN.
 * A per-day counter is stored in the `counters` collection and
 * incremented atomically with findOneAndUpdate to guarantee
 * uniqueness across concurrent writes.
 */

function formatDateKey(date = new Date()) {
  // UTC date in YYYYMMDD form
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function buildCaseNumber(dateKey, seq) {
  return `SR-${dateKey}-${String(seq).padStart(5, '0')}`;
}

/**
 * Generate the next case number for the given db.
 * @param {Db} db - a connected mongodb Db instance
 * @param {Date} [now] - optional injected clock (for tests)
 */
async function nextCaseNumber(db, now = new Date()) {
  const dateKey = formatDateKey(now);
  const counterId = `SR-${dateKey}`;

  const result = await db.collection('counters').findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );

  // The mongodb driver returns either { value: doc } (legacy) or the doc itself
  // depending on version. Handle both shapes.
  const doc = result && result.value ? result.value : result;
  const seq = doc && typeof doc.seq === 'number' ? doc.seq : 1;

  return buildCaseNumber(dateKey, seq);
}

module.exports = { nextCaseNumber, formatDateKey, buildCaseNumber };
