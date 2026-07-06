const { test } = require('node:test');
const assert = require('node:assert');
const { requireAuth, requireRole } = require('../src/auth/middleware');

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('requireAuth blocca senza sessione', () => {
  const res = mockRes(); let called = false;
  requireAuth({ session: {} }, res, () => { called = true; });
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(called, false);
});

test('requireAuth passa con utente in sessione', () => {
  const res = mockRes(); let called = false;
  requireAuth({ session: { user: { id: 1 } } }, res, () => { called = true; });
  assert.strictEqual(called, true);
});

test('requireRole nega ruolo non ammesso con 403', () => {
  const res = mockRes(); let called = false;
  requireRole('admin')({ session: { user: { role: 'reception' } } }, res, () => { called = true; });
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(called, false);
});

test('requireRole ammette ruolo valido', () => {
  const res = mockRes(); let called = false;
  requireRole('admin', 'reception')({ session: { user: { role: 'reception' } } }, res, () => { called = true; });
  assert.strictEqual(called, true);
});
