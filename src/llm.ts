import { TOOL_DEFS } from "./tools.js";

export type ToolCall = { id: string; name: string; arguments: string };
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface LlmClient {
  chat(messages: Msg[]): Promise<{ content: string | null; tool_calls: ToolCall[] }>;
}

/** OpenAI-compatible chat client. Defaults to a local Ollama server. */
export class OpenAiCompatClient implements LlmClient {
  constructor(
    private baseUrl = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1",
    private model = process.env.LLM_MODEL ?? "qwen2.5:7b",
    private apiKey = process.env.LLM_API_KEY ?? "ollama",
    private timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 60000),
  ) {}

  async chat(messages: Msg[]) {
    const wire = messages.map((m) =>
      m.role === "assistant" && m.tool_calls
        ? { role: "assistant", content: m.content, tool_calls: m.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.arguments } })) }
        : m);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, temperature: 0, messages: wire, tools: TOOL_DEFS, tool_choice: "auto" }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const msg: any = (await res.json())?.choices?.[0]?.message;
    if (!msg) throw new Error("LLM returned no message");
    const tool_calls: ToolCall[] = (msg.tool_calls ?? []).map((t: any, i: number) => ({
      id: t.id ?? `call_${i}`, name: t.function?.name, arguments: t.function?.arguments ?? "{}",
    }));
    return { content: msg.content ?? null, tool_calls };
  }
}
