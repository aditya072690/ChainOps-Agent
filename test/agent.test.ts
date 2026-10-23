import { describe, it, expect } from "vitest";
import request from "supertest";
import { runAgent } from "../src/agent.js";
import { setup, ADMIN } from "./helpers.js";

describe("agent loop", () => {
  it("calls a tool, feeds the result back, then answers", async () => {
    const { db, model } = await setup([
      { tools: [{ name: "get_payment", args: { payment_id: "pay_003" } }] },
      { content: "pay_003 is pending with 2 confirmations." },
    ]);
    const r = await runAgent("status of pay_003?", db, model.llm);
    expect(r.steps).toBe(2);
    expect(r.toolCalls).toEqual([{ name: "get_payment", ok: true }]);
    const toolMsg = model.seen[1].find((m) => m.role === "tool");
    expect(JSON.parse(toolMsg.content)).toMatchObject({ id: "pay_003", status: "pending" });
  });

  it("returns invalid arguments to the model as an error so it can self-correct", async () => {
    const { db, model } = await setup([
      { tools: [{ name: "list_payments", args: { status: "done", limit: 500 } }] },
      { tools: [{ name: "list_payments", args: { status: "failed" } }] },
      { content: "There are 2 failed payments." },
    ]);
    const r = await runAgent("failed payments?", db, model.llm);
    expect(r.toolCalls.map((t) => t.ok)).toEqual([false, true]);
    expect(JSON.parse(model.seen[1].find((m) => m.role === "tool").content).error).toBeTruthy();
  });

  it("survives malformed JSON arguments and unknown tools", async () => {
    const { db, model } = await setup([
      { tools: [{ name: "get_payment", args: "{not json" }, { name: "drop_tables", args: {} }] },
      { content: "Sorry, I could not do that." },
    ]);
    const r = await runAgent("x", db, model.llm);
    expect(r.toolCalls.map((t) => t.ok)).toEqual([false, false]);
  });

  it("stops at the step limit instead of looping forever", async () => {
    const { db, model } = await setup([{ tools: [{ name: "list_payments", args: {} }] }]);
    const r = await runAgent("loop", db, model.llm, 3);
    expect(r.steps).toBe(3);
    expect(model.calls()).toBe(3);
  });

  it("writes every tool call to the audit log", async () => {
    const { db, model } = await setup([
      { tools: [{ name: "volume_summary", args: { days: 30 } }] }, { content: "done" }]);
    await runAgent("volume?", db, model.llm);
    const a = await db.query("SELECT tool, ok FROM audit_log");
    expect(a.rows).toEqual([{ tool: "volume_summary", ok: true }]);
  });

  it("volume_summary only counts confirmed payments", async () => {
    const { db, model } = await setup([
      { tools: [{ name: "volume_summary", args: { days: 7 } }] }, { content: "done" }]);
    await runAgent("volume?", db, model.llm);
    const res = JSON.parse(model.seen[1].find((m) => m.role === "tool").content);
    expect(res).toEqual([
      { asset: "USDC", payments: 2, total: 340.5 },
      { asset: "USDT", payments: 1, total: 600 },
    ]);
  });
});

describe("refund guardrail (human in the loop)", () => {
  it("agent can only request a refund; it stays pending until an admin approves", async () => {
    const { db, app, model } = await setup([
      { tools: [{ name: "request_refund", args: { payment_id: "pay_001", reason: "charged twice" } }] },
      { content: "Refund requested, awaiting approval." },
    ]);
    await runAgent("refund pay_001", db, model.llm);
    const pending = await db.query("SELECT id, status FROM refund_requests");
    expect(pending.rows).toEqual([{ id: 1, status: "pending_approval" }]);

    expect((await request(app).post("/refunds/1/approve")).status).toBe(401);
    expect((await request(app).post("/refunds/1/approve").set("x-api-key", "nope")).status).toBe(401);
    const ok = await request(app).post("/refunds/1/approve").set("x-api-key", ADMIN);
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("approved");
    expect((await request(app).post("/refunds/1/approve").set("x-api-key", ADMIN)).status).toBe(404);
  });

  it("refund for a non-existent payment is rejected", async () => {
    const { db, model } = await setup([
      { tools: [{ name: "request_refund", args: { payment_id: "pay_999", reason: "test" } }] }, { content: "no" }]);
    const r = await runAgent("refund pay_999", db, model.llm);
    expect(r.toolCalls[0].ok).toBe(false);
  });
});

describe("POST /agent/ask", () => {
  it("validates input and returns the agent answer", async () => {
    const { app } = await setup([{ content: "hello" }]);
    expect((await request(app).post("/agent/ask").send({ question: " " })).status).toBe(400);
    const res = await request(app).post("/agent/ask").send({ question: "hi" });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("hello");
  });
});
