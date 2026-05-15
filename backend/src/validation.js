'use strict';

/**
 * Lightweight validator — no external schema lib so the surface stays small
 * and the rules are easy to read.
 */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPhone(v) {
  // Accept digits, spaces, parens, dashes, plus. 7-20 chars after stripping.
  if (typeof v !== 'string') return false;
  const stripped = v.replace(/[\s()\-+]/g, '');
  return /^\d{7,20}$/.test(stripped);
}

function isEmail(v) {
  if (typeof v !== 'string') return false;
  // Pragmatic regex — not RFC 5322, but rejects obvious garbage.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

/**
 * Validate a payload for POST /api/cases.
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
function validateCreateCase(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['Request body must be a JSON object'] };
  }

  const equipment = payload.equipment || {};
  const customer = payload.customer || {};

  if (!isNonEmptyString(equipment.serialNumber)) {
    errors.push('equipment.serialNumber is required');
  }
  if (!isNonEmptyString(equipment.productModel)) {
    errors.push('equipment.productModel is required');
  }
  if (!isNonEmptyString(equipment.issueDescription)) {
    errors.push('equipment.issueDescription is required');
  }
  if (equipment.purchaseDate !== undefined && equipment.purchaseDate !== null) {
    if (!isNonEmptyString(equipment.purchaseDate) || isNaN(Date.parse(equipment.purchaseDate))) {
      errors.push('equipment.purchaseDate must be a valid ISO date string');
    }
  }

  if (!isNonEmptyString(customer.name)) {
    errors.push('customer.name is required');
  }
  if (!isPhone(customer.phone)) {
    errors.push('customer.phone is required and must be a valid phone number');
  }
  if (customer.email !== undefined && customer.email !== null && customer.email !== '') {
    if (!isEmail(customer.email)) {
      errors.push('customer.email must be a valid email address');
    }
  }

  if (errors.length) return { ok: false, errors };

  // Normalize — return a clean, trimmed object
  return {
    ok: true,
    value: {
      equipment: {
        serialNumber: equipment.serialNumber.trim(),
        productModel: equipment.productModel.trim(),
        issueDescription: equipment.issueDescription.trim(),
        purchaseDate: equipment.purchaseDate ? equipment.purchaseDate.trim() : null,
      },
      customer: {
        name: customer.name.trim(),
        phone: customer.phone.trim(),
        email: customer.email ? customer.email.trim() : null,
        address: isNonEmptyString(customer.address) ? customer.address.trim() : null,
      },
    },
  };
}

function validateStatus(status) {
  return VALID_STATUSES.includes(status);
}

module.exports = {
  validateCreateCase,
  validateStatus,
  VALID_STATUSES,
  // exported for tests
  _internals: { isPhone, isEmail, isNonEmptyString },
};
