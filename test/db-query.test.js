const { test } = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db/query');

function fakePool(recordset) {
  const bound = {};
  return {
    _bound: bound,
    _lastQuery: null,
    request() {
      const self = this;
      return {
        input(k, v) { bound[k] = v; return this; },
        async query(text) { self._lastQuery = text; return { recordset }; },
      };
    },
  };
}

test('query lega i parametri e restituisce il recordset', async () => {
  const pool = fakePool([{ id: 1 }]);
  const db = createDb(pool);
  const rows = await db.query('SELECT * FROM t WHERE id=@id', { id: 1 });
  assert.deepStrictEqual(rows, [{ id: 1 }]);
  assert.strictEqual(pool._bound.id, 1);
  assert.match(pool._lastQuery, /SELECT/);
});
