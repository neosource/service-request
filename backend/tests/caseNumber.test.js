'use strict';

const {
  formatDateKey,
  buildCaseNumber,
  nextCaseNumber,
} = require('../src/caseNumber');

describe('caseNumber', () => {
  test('formatDateKey uses UTC YYYYMMDD', () => {
    // Pick a date that would differ in some non-UTC timezones
    const d = new Date(Date.UTC(2026, 0, 5, 23, 30)); // 2026-01-05 23:30 UTC
    expect(formatDateKey(d)).toBe('20260105');
  });

  test('buildCaseNumber pads the sequence to 5 digits', () => {
    expect(buildCaseNumber('20260514', 1)).toBe('SR-20260514-00001');
    expect(buildCaseNumber('20260514', 42)).toBe('SR-20260514-00042');
    expect(buildCaseNumber('20260514', 99999)).toBe('SR-20260514-99999');
  });

  test('nextCaseNumber uses atomic findOneAndUpdate and returns formatted id', async () => {
    // Mock a minimal db with a counters collection
    let lastArgs = null;
    let seq = 0;
    const fakeDb = {
      collection(name) {
        expect(name).toBe('counters');
        return {
          async findOneAndUpdate(filter, update, options) {
            lastArgs = { filter, update, options };
            seq += 1;
            return { value: { _id: filter._id, seq } };
          },
        };
      },
    };

    const fixedNow = new Date(Date.UTC(2026, 4, 14, 10, 0, 0));
    const a = await nextCaseNumber(fakeDb, fixedNow);
    const b = await nextCaseNumber(fakeDb, fixedNow);

    expect(a).toBe('SR-20260514-00001');
    expect(b).toBe('SR-20260514-00002');
    expect(lastArgs.filter).toEqual({ _id: 'SR-20260514' });
    expect(lastArgs.update).toEqual({ $inc: { seq: 1 } });
    expect(lastArgs.options).toEqual({ upsert: true, returnDocument: 'after' });
  });

  test('nextCaseNumber handles modern driver shape (no .value wrapper)', async () => {
    const fakeDb = {
      collection() {
        return {
          async findOneAndUpdate() {
            // Newer driver may return the document directly
            return { _id: 'SR-20260514', seq: 7 };
          },
        };
      },
    };
    const fixedNow = new Date(Date.UTC(2026, 4, 14));
    const n = await nextCaseNumber(fakeDb, fixedNow);
    expect(n).toBe('SR-20260514-00007');
  });
});
