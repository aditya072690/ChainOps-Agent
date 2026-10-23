import { openDb } from "./db.js";
import { seed } from "./seed.js";
import { runAgent } from "./agent.js";
import { OpenAiCompatClient, type LlmClient, type Msg } from "./llm.js";

/** Scores the real model: did it pick the right first tool with the right arguments? */
const cases: { q: string; tool: string; args?: Record<string, unknown> }[] = [
  { q: "What is the status of payment pay_003?", tool: "get_payment", args: { payment_id: "pay_003" } },
  { q: "Look up transaction 0xe91b05", tool: "get_payment", args: { tx_hash: "0xe91b05" } },
  { q: "Show me the failed payments", tool: "list_payments", args: { status: "failed" } },
  { q: "List the pending payments", tool: "list_payments", args: { status: "pending" } },
  { q: "How much volume did we confirm in the last 30 days?", tool: "volume_summary", args: { days: 30 } },
  { q: "Total confirmed volume this week", tool: "volume_summary", args: { days: 7 } },
  { q: "Please refund pay_001, the customer was charged twice", tool: "request_refund", args: { payment_id: "pay_001" } },
  { q: "Refund pay_004 because the customer cancelled", tool: "request_refund", args: { payment_id: "pay_004" } },
];

const db = await openDb(undefined);
await seed(db);
const base = new OpenAiCompatClient();
let firstCall: { name: string; args: any } | null = null;
const spy: LlmClient = { async chat(m: Msg[]) {
  const r = await base.chat(m);
  if (!firstCall && r.tool_calls[0]) { try { firstCall = { name: r.tool_calls[0].name, args: JSON.parse(r.tool_calls[0].arguments) }; } catch { firstCall = { name: r.tool_calls[0].name, args: {} }; } }
  return r;
} };

let toolOk = 0, argsOk = 0, steps = 0, ms = 0, errors = 0;
for (const c of cases) {
  firstCall = null;
  const t = Date.now();
  try {
    const r = await runAgent(c.q, db, spy);
    ms += Date.now() - t; steps += r.steps;
    const fc = firstCall as { name: string; args: any } | null;
    const tOk = fc?.name === c.tool;
    const aOk = tOk && Object.entries(c.args ?? {}).every(([k, v]) => fc!.args[k] === v);
    if (tOk) toolOk++; if (aOk) argsOk++;
    if (!aOk) console.log(`MISS "${c.q}" -> ${fc ? fc.name + " " + JSON.stringify(fc.args) : "no tool call"}`);
  } catch (e) { errors++; console.log(`ERROR "${c.q}": ${(e as Error).message}`); }
}
const n = cases.length;
console.log(`\nCases: ${n} | correct tool: ${toolOk}/${n} | correct tool+args: ${argsOk}/${n} | errors: ${errors} | avg steps: ${(steps / n).toFixed(1)} | avg latency: ${Math.round(ms / n)}ms`);
