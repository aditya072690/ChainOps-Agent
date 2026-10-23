import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  tx_hash       TEXT UNIQUE NOT NULL,
  chain         TEXT NOT NULL,
  asset         TEXT NOT NULL,
  amount        DOUBLE PRECISION NOT NULL CHECK (amount > 0),
  status        TEXT NOT NULL CHECK (status IN ('pending','confirmed','failed')),
  confirmations INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, created_at DESC);
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id    TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refund_requests (
  id          SERIAL PRIMARY KEY,
  payment_id  TEXT NOT NULL REFERENCES payments(id),
  reason      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval','approved')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS audit_log (
  id     SERIAL PRIMARY KEY,
  tool   TEXT NOT NULL,
  args   JSONB NOT NULL,
  result JSONB NOT NULL,
  ok     BOOLEAN NOT NULL,
  at     TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

/** Real PostgreSQL when DATABASE_URL is set; otherwise embedded Postgres (PGlite) so it runs with zero setup. */
export async function openDb(url = process.env.DATABASE_URL, dataDir?: string): Promise<Db> {
  let db: Db;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    db = { query: (s, p) => pool.query(s, p as any[]) as any, exec: async (s) => void (await pool.query(s)) };
  } else {
    const lite = dataDir ? new PGlite(dataDir) : new PGlite();
    db = { query: (s, p) => lite.query(s, p as any[]) as any, exec: async (s) => void (await lite.exec(s)) };
  }
  await db.exec(SCHEMA);
  return db;
}
