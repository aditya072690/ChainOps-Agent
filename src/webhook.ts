import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.js";

export function sign(rawBody: Buffer | string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(sign(rawBody, secret), "hex");
  const given = Buffer.from(signature, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const ChainEventSchema = z.object({
  event_id: z.string().min(1),
  type: z.enum(["payment.pending", "payment.confirmed", "payment.failed"]),
  payment: z.object({
    id: z.string().min(1),
    tx_hash: z.string().min(1),
    chain: z.string().min(1),
    asset: z.string().min(1),
    amount: z.number().positive(),
    confirmations: z.number().int().min(0),
  }),
});
export type ChainEvent = z.infer<typeof ChainEventSchema>;

const STATUS = { "payment.pending": "pending", "payment.confirmed": "confirmed", "payment.failed": "failed" } as const;

/**
 * Idempotent: the event_id primary key makes a replayed webhook a no-op.
 * Out-of-order safe: an older event (fewer confirmations) never overwrites newer state.
 */
export async function ingestEvent(db: Db, ev: ChainEvent): Promise<{ duplicate: boolean }> {
  const ins = await db.query(
    "INSERT INTO webhook_events (event_id, payload) VALUES ($1, $2::jsonb) ON CONFLICT (event_id) DO NOTHING RETURNING event_id",
    [ev.event_id, JSON.stringify(ev)],
  );
  if (ins.rows.length === 0) return { duplicate: true };
  const p = ev.payment;
  await db.query(
    `INSERT INTO payments (id, tx_hash, chain, asset, amount, status, confirmations)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, confirmations = EXCLUDED.confirmations, updated_at = now()
     WHERE payments.confirmations <= EXCLUDED.confirmations`,
    [p.id, p.tx_hash, p.chain, p.asset, p.amount, STATUS[ev.type], p.confirmations],
  );
  return { duplicate: false };
}
