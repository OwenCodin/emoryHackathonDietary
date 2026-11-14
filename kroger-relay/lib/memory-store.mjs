// In-memory store for tests, the local dev server and the local end-to-end test.
// Same interface as blob-store.mjs: put / get / del / sweep.
export function createMemoryStore() {
  const records = new Map();
  return {
    async put(state, { code, at }) {
      if (records.has(state)) return { ok: false, exists: true };
      records.set(state, { code, at });
      return { ok: true };
    },
    async get(state) {
      const r = records.get(state);
      return r ? { code: r.code, at: r.at } : null;
    },
    async del(state) {
      records.delete(state);
    },
    async sweep(cutoffMs) {
      for (const [state, r] of records) if (r.at < cutoffMs) records.delete(state);
    },
  };
}
