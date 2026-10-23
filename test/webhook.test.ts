import { describe, it, expect } from "vitest";
import request from "supertest";
import { setup, event, signed } from "./helpers.js";

const post = (app: any, raw: string, sig?: string) =>
  request(app).post("/webhooks/chain").set("content-type", "application/json").set("x-signature", sig ?? "").send(raw);

describe("POST /webhooks/chain", () => {
  it("rejects a missing or wrong signature with 401", async () => {
    const { app } = await setup();
    const { raw } = signed(event());
    expect((await post(app, raw)).status).toBe(401);
    expect((await post(app, raw, signed(event(), "wrong-secret").sig)).status).toBe(401);
  });

  it("rejects a body that was modified after signing", async () => {
    const { app } = await setup();
    const { raw, sig } = signed(event());
    expect((await post(app, raw.replace("75", "7500"), sig)).status).toBe(401);
  });

  it("stores a valid event and creates the payment", async () => {
    const { app, db } = await setup();
    const { raw, sig } = signed(event());
    const res = await post(app, raw, sig);
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(false);
    const p = await db.query("SELECT status, confirmations FROM payments WHERE id='pay_100'");
    expect(p.rows[0]).toEqual({ status: "confirmed", confirmations: 12 });
  });

  it("is idempotent: replaying the same event_id changes nothing", async () => {
    const { app, db } = await setup();
    const { raw, sig } = signed(event());
    await post(app, raw, sig);
    const again = await post(app, raw, sig);
    expect(again.body.duplicate).toBe(true);
    const n = await db.query("SELECT count(*)::int AS n FROM webhook_events WHERE event_id='evt_1'");
    expect(n.rows[0].n).toBe(1);
  });

  it("ignores an out-of-order older event", async () => {
    const { app, db } = await setup();
    const newer = signed(event({ event_id: "evt_new" }));
    const older = signed(event({ event_id: "evt_old", type: "payment.pending",
      payment: { id: "pay_100", tx_hash: "0x100", chain: "ethereum", asset: "USDC", amount: 75, confirmations: 1 } }));
    await post(app, newer.raw, newer.sig);
    await post(app, older.raw, older.sig);
    const p = await db.query("SELECT status, confirmations FROM payments WHERE id='pay_100'");
    expect(p.rows[0]).toEqual({ status: "confirmed", confirmations: 12 });
  });

  it("returns 400 for a correctly signed but invalid event", async () => {
    const { app } = await setup();
    const { raw, sig } = signed({ event_id: "x", type: "payment.confirmed", payment: { id: "p" } });
    expect((await post(app, raw, sig)).status).toBe(400);
  });
});
