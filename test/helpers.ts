import { openDb } from "../src/db.js";
import { seed } from "../src/seed.js";
import type { LlmClient, ToolCall } from "../src/llm.js";
import { sign } from "../src/webhook.js";
import { createApp } from "../src/server.js";

export const SECRET = "test-secret";
export const ADMIN = "test-admin";

export type Step = { content?: string | null; tools?: { name: string; args: unknown | string }[] };
/** A fake model that plays back a scripted list of replies and records what it was sent. */
export function scripted(steps: Step[]) {
  const seen: any[][] = [];
  let i = 0;
  const llm: LlmClient = {
    async chat(messages) {
      seen.push(JSON.parse(JSON.stringify(messages)));
      const s = steps[Math.min(i, steps.length - 1)]; i++;
      const tool_calls: ToolCall[] = (s.tools ?? []).map((t, k) => ({
        id: `c${i}_${k}`, name: t.name, arguments: typeof t.args === "string" ? t.args : JSON.stringify(t.args) }));
      return { content: s.content ?? null, tool_calls };
    },
  };
  return { llm, seen, calls: () => i };
}

export async function setup(steps: Step[] = [{ content: "ok" }]) {
  const db = await openDb(undefined);
  await seed(db);
  const model = scripted(steps);
  const app = createApp({ db, llm: model.llm, webhookSecret: SECRET, adminKey: ADMIN });
  return { db, app, model };
}

export const event = (over: any = {}) => ({
  event_id: "evt_1", type: "payment.confirmed",
  payment: { id: "pay_100", tx_hash: "0x100", chain: "ethereum", asset: "USDC", amount: 75, confirmations: 12 }, ...over,
});
export const signed = (body: unknown, secret = SECRET) => {
  const raw = JSON.stringify(body);
  return { raw, sig: sign(raw, secret) };
};
