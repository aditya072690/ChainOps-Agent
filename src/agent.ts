import type { Db } from "./db.js";
import type { LlmClient, Msg } from "./llm.js";
import { runTool } from "./tools.js";

export const SYSTEM_PROMPT =
  "You are a payment operations assistant for a crypto payments platform. " +
  "Use the tools for every factual claim about payments; never invent payment data, amounts or hashes. " +
  "You cannot move money: request_refund only creates a request that a human approves. " +
  "If a tool returns an error, correct your arguments or explain the problem to the user. Keep answers short.";

export type AgentResult = { answer: string; steps: number; toolCalls: { name: string; ok: boolean }[] };

/**
 * Bounded tool-calling loop. Tool arguments are validated (Zod); validation or execution errors are
 * returned to the model as the tool result so it can self-correct. Every call is audit-logged.
 */
export async function runAgent(question: string, db: Db, llm: LlmClient, maxSteps = 5): Promise<AgentResult> {
  const messages: Msg[] = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: question }];
  const toolCalls: AgentResult["toolCalls"] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const reply = await llm.chat(messages);
    if (reply.tool_calls.length === 0) {
      return { answer: reply.content ?? "", steps: step, toolCalls };
    }
    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      let ok = true;
      let result: unknown;
      let args: unknown = {};
      try {
        args = JSON.parse(call.arguments);
        result = await runTool(db, call.name, args);
      } catch (e) {
        ok = false;
        result = { error: e instanceof Error ? e.message : String(e) };
      }
      toolCalls.push({ name: call.name, ok });
      await db.query("INSERT INTO audit_log (tool, args, result, ok) VALUES ($1,$2::jsonb,$3::jsonb,$4)",
        [call.name, JSON.stringify(args ?? {}), JSON.stringify(result ?? null), ok]);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { answer: "I could not finish within the step limit. Please narrow the question.", steps: maxSteps, toolCalls };
}
