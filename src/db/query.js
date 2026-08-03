// Costruisce una clausola IN da una lista di id INTERI. Ogni valore è forzato a
// intero validato (throw se non lo è) → interpolazione sicura, senza param dinamici.
// Accetta un singolo numero o un array. Vuoto → "(NULL)" (non matcha nulla).
function inClause(ids) {
  const arr = Array.isArray(ids) ? ids : [ids];
  const nums = arr.map((v) => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`inClause: id non intero: ${v}`);
    return n;
  });
  return nums.length ? `(${nums.join(', ')})` : '(NULL)';
}

function createDb(pool) {
  return {
    async query(text, params = {}) {
      const request = pool.request();
      for (const [key, value] of Object.entries(params)) {
        request.input(key, value);
      }
      const result = await request.query(text);
      return result.recordset;
    },
    async close() {
      await pool.close();
    },
  };
}

module.exports = { createDb, inClause };
