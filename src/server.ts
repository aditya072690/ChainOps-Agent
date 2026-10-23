import express from "express";
import { z } from "zod";
import type { Db } from "./db.js";
import type { LlmClient } from "./llm.js";
import { runAgent } from "./agent.js";
import { ChainEventSchema, ingestEvent, verifySignature } from "./webhook.js";

export type Deps = { db: Db; llm: LlmClient; webhookSecret: string; adminKey: string };

export function createApp({ db, llm, webhookSecret, adminKey }: Deps) {
  const app = express();
  const stats = { webhooks: 0, duplicates: 0, rejected: 0, agentRequests: 0, agentFailures: 0, agentLatencyMs: 0 };

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/metrics", (_req, res) =>
    res.json({ ...stats, avgAgentLatencyMs: stats.agentRequests ? Math.round(stats.agentLatencyMs / stats.agentRequests) : 0 }));

  // Raw body is required so the HMAC is computed over the exact bytes that were signed.
  app.post("/webhooks/chain", express.raw({ type: "application/json", limit: "100kb" }), async (req, res) => {
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw) || !verifySignature(raw, req.header("x-signature"), webhookSecret)) {
      stats.rejected++;
      return res.status(401).json({ error: "invalid signature" });
    }
    let parsed;
    try { parsed = ChainEventSchema.safeParse(JSON.parse(raw.toString("utf8"))); }
    catch { return res.status(400).json({ error: "invalid JSON" }); }
    if (!parsed.success) return res.status(400).json({ error: "invalid event" });
    const { duplicate } = await ingestEvent(db, parsed.data);
    stats.webhooks++;
    if (duplicate) stats.duplicates++;
    res.status(200).json({ received: true, duplicate });
  });

  const json = express.json({ limit: "10kb" });

  app.post("/agent/ask", json, async (req, res) => {
    const body = z.object({ question: z.string().trim().min(1).max(500) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "question is required (1-500 chars)" });
    const t = Date.now();
    stats.agentRequests++;
    try {
      res.json(await runAgent(body.data.question, db, llm));
    } catch (e) {
      stats.agentFailures++;
      res.status(502).json({ error: (e as Error).message });
    } finally {
      stats.agentLatencyMs += Date.now() - t;
    }
  });

  // Human-in-the-loop: only an authenticated admin can approve what the agent requested.
  app.post("/refunds/:id/approve", json, async (req, res) => {
    if (req.header("x-api-key") !== adminKey) return res.status(401).json({ error: "unauthorized" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "bad id" });
    const r = await db.query(
      "UPDATE refund_requests SET status='approved', approved_at=now() WHERE id=$1 AND status='pending_approval' RETURNING id, payment_id, status", [id]);
    if (!r.rows[0]) return res.status(404).json({ error: "no pending refund with that id" });
    res.json(r.rows[0]);
  });

  return app;
}
