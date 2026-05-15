'use strict';

const {
  validateCreateCase,
  validateStatus,
  _internals,
} = require('../src/validation');

describe('validation: phone & email', () => {
  test('accepts common phone formats', () => {
    expect(_internals.isPhone('+1 (555) 010-0123')).toBe(true);
    expect(_internals.isPhone('5550100123')).toBe(true);
    expect(_internals.isPhone('+91 98765 43210')).toBe(true);
  });

  test('rejects clearly invalid phone', () => {
    expect(_internals.isPhone('abc')).toBe(false);
    expect(_internals.isPhone('123')).toBe(false);
    expect(_internals.isPhone('')).toBe(false);
    expect(_internals.isPhone(null)).toBe(false);
  });

  test('email check', () => {
    expect(_internals.isEmail('jane@example.com')).toBe(true);
    expect(_internals.isEmail('jane@example')).toBe(false);
    expect(_internals.isEmail('not-an-email')).toBe(false);
  });
});

describe('validateCreateCase', () => {
  const good = {
    equipment: {
      serialNumber: 'SN-12345',
      productModel: 'AX-200',
      issueDescription: 'Will not power on',
    },
    customer: {
      name: 'Jane Doe',
      phone: '+1-555-010-0100',
    },
  };

  test('passes a minimally complete payload', () => {
    const r = validateCreateCase(good);
    expect(r.ok).toBe(true);
    expect(r.value.equipment.serialNumber).toBe('SN-12345');
    expect(r.value.customer.address).toBeNull();
  });

  test('trims string fields', () => {
    const r = validateCreateCase({
      equipment: {
        serialNumber: '  SN-1  ',
        productModel: ' AX-200 ',
        issueDescription: ' broken ',
      },
      customer: { name: ' Jane ', phone: '5550100' },
    });
    expect(r.ok).toBe(true);
    expect(r.value.equipment.serialNumber).toBe('SN-1');
    expect(r.value.customer.name).toBe('Jane');
  });

  test('rejects when required equipment fields are missing', () => {
    const r = validateCreateCase({
      equipment: { serialNumber: '', productModel: '', issueDescription: '' },
      customer: { name: 'x', phone: '5551234567' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/serialNumber/),
        expect.stringMatching(/productModel/),
        expect.stringMatching(/issueDescription/),
      ])
    );
  });

  test('rejects when phone is invalid', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.customer.phone = 'not-a-number';
    const r = validateCreateCase(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /phone/.test(e))).toBe(true);
  });

  test('rejects an invalid optional email', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.customer.email = 'nope';
    const r = validateCreateCase(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /email/.test(e))).toBe(true);
  });

  test('rejects an invalid optional purchaseDate', () => {
    const bad = JSON.parse(JSON.stringify(good));
    bad.equipment.purchaseDate = 'not-a-date';
    const r = validateCreateCase(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /purchaseDate/.test(e))).toBe(true);
  });

  test('accepts a valid optional email and purchaseDate', () => {
    const ok = JSON.parse(JSON.stringify(good));
    ok.customer.email = 'jane@example.com';
    ok.equipment.purchaseDate = '2024-03-15';
    const r = validateCreateCase(ok);
    expect(r.ok).toBe(true);
    expect(r.value.customer.email).toBe('jane@example.com');
    expect(r.value.equipment.purchaseDate).toBe('2024-03-15');
  });

  test('rejects non-object payload', () => {
    expect(validateCreateCase(null).ok).toBe(false);
    expect(validateCreateCase('hi').ok).toBe(false);
  });
});

describe('validateStatus', () => {
  test('accepts known statuses', () => {
    ['open', 'in_progress', 'resolved', 'closed'].forEach((s) =>
      expect(validateStatus(s)).toBe(true)
    );
  });
  test('rejects unknown statuses', () => {
    expect(validateStatus('done')).toBe(false);
    expect(validateStatus('')).toBe(false);
    expect(validateStatus(null)).toBe(false);
  });
});
