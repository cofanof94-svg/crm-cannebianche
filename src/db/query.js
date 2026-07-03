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

module.exports = { createDb };
