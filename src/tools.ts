import { z } from "zod";
import type { Db } from "./db.js";

const Status = z.enum(["pending", "confirmed", "failed"]);

export const schemas = {
  get_payment: z.object({ payment_id: z.string().optional(), tx_hash: z.string().optional() })
    .refine((v) => v.payment_id || v.tx_hash, "provide payment_id or tx_hash"),
  list_payments: z.object({ status: Status.optional(), limit: z.number().int().min(1).max(20).default(10) }),
  volume_summary: z.object({ days: z.number().int().min(1).max(90).default(7) }),
  request_refund: z.object({ payment_id: z.string().min(1), reason: z.string().min(3).max(300) }),
} as const;
export type ToolName = keyof typeof schemas;

export const TOOL_DEFS = [
  { name: "get_payment", description: "Look up one payment by payment_id or tx_hash.",
    parameters: { type: "object", properties: { payment_id: { type: "string" }, tx_hash: { type: "string" } } } },
  { name: "list_payments", description: "List recent payments, optionally filtered by status.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["pending", "confirmed", "failed"] }, limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "volume_summary", description: "Total confirmed volume per asset over the last N days.",
    parameters: { type: "object", properties: { days: { type: "integer", minimum: 1, maximum: 90 } } } },
  { name: "request_refund", description: "Request a refund for a payment. This does NOT refund; it creates a request that a human must approve.",
    parameters: { type: "object", properties: { payment_id: { type: "string" }, reason: { type: "string" } }, required: ["payment_id", "reason"] } },
].map((f) => ({ type: "function" as const, function: f }));

export async function runTool(db: Db, name: string, rawArgs: unknown): Promise<unknown> {
  if (!(name in schemas)) throw new Error(`Unknown tool: ${name}`);
  const args = schemas[name as ToolName].parse(rawArgs) as any;
  switch (name as ToolName) {
    case "get_payment": {
      const r = await db.query("SELECT * FROM payments WHERE id = $1 OR tx_hash = $2", [args.payment_id ?? null, args.tx_hash ?? null]);
      if (!r.rows[0]) throw new Error("Payment not found");
      return r.rows[0];
    }
    case "list_payments": {
      const r = await db.query(
        "SELECT id, tx_hash, chain, asset, amount, status, confirmations FROM payments WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT $2",
        [args.status ?? null, args.limit]);
      return r.rows;
    }
    case "volume_summary": {
      const r = await db.query(
        `SELECT asset, count(*)::int AS payments, sum(amount)::float8 AS total FROM payments
         WHERE status = 'confirmed' AND created_at > now() - ($1::int * interval '1 day') GROUP BY asset ORDER BY asset`, [args.days]);
      return r.rows;
    }
    case "request_refund": {
      const exists = await db.query("SELECT 1 FROM payments WHERE id = $1", [args.payment_id]);
      if (!exists.rows[0]) throw new Error("Payment not found");
      const r = await db.query("INSERT INTO refund_requests (payment_id, reason) VALUES ($1,$2) RETURNING id, status", [args.payment_id, args.reason]);
      return { ...r.rows[0], note: "Pending human approval; no money has moved." };
    }
  }
}
