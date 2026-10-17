// Where telemetry events go. Same two-backend pattern as rating_store.mjs: MemoryEventsStore for tests, SupabaseEventsStore for the real
// table (public.ie_events, api/events_schema.sql) called with the service key from the server only.
export class MemoryEventsStore {
  constructor() { this.rows = []; }
  async insert(rows) { for (const r of rows) this.rows.push({ ...r, ts: new Date().toISOString() }); return true; }
}

export class SupabaseEventsStore {
  constructor({ url, key, fetchFn = fetch }) {
    this.base = `${String(url).replace(/\/+$/, '')}/rest/v1`;
    this.key = key;
    this.fetch = fetchFn;
  }

  async insert(rows) {
    // new-style secret keys (sb_secret_...) go in the apikey header alone; legacy service_role JWTs also as Bearer (as in rating_store.mjs)
    const headers = { apikey: this.key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    if (!this.key.startsWith('sb_')) headers.Authorization = `Bearer ${this.key}`;
    const res = await this.fetch(`${this.base}/ie_events`, { method: 'POST', headers, body: JSON.stringify(rows) });
    if (res.status >= 400) throw new Error(`supabase events: ${res.status}`);
    return true;
  }
}
