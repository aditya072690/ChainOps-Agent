# ChainOps Agent — LLM agent for payment & blockchain-webhook operations

An ops assistant for a crypto payments platform. Ask questions in plain English; the LLM answers by **calling tools over a PostgreSQL ledger**. Blockchain payment events arrive via **signed, idempotent webhooks**.

## Architecture
- `POST /webhooks/chain` — HMAC-SHA256 signature check over the raw body (timing-safe), Zod-validated event, idempotent insert (`event_id` primary key), out-of-order protection (older events never overwrite newer state).
- `POST /agent/ask` — bounded tool-calling loop (max 5 steps). Tool args are validated with Zod; errors go back to the model so it can self-correct. Every call is written to `audit_log`.
- Tools: `get_payment`, `list_payments`, `volume_summary`, `request_refund`.
- **Human in the loop:** `request_refund` only creates a `pending_approval` row. Only `POST /refunds/:id/approve` with `x-api-key` can approve it. The agent cannot move money.
- `GET /metrics` — webhook, duplicate, rejection, agent request/failure counts and average latency.
- DB: real PostgreSQL if `DATABASE_URL` is set, otherwise embedded Postgres (PGlite) so it runs with zero setup.
- LLM: any OpenAI-compatible endpoint; defaults to Ollama + `qwen2.5:7b`.

## Run
```
npm install
npm test                         # 15 tests: real (embedded) Postgres + scripted model, no LLM needed
ollama pull qwen2.5:7b
npm run eval                     # scores the real model: correct tool / correct tool+args on 8 cases
SEED=1 npm run dev               # API on :3000 with sample payments
```
Env: `DATABASE_URL`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `WEBHOOK_SECRET`, `ADMIN_API_KEY`.

## Try it
```
curl -s localhost:3000/agent/ask -H 'content-type: application/json' \
  -d '{"question":"Show me the failed payments"}'

BODY='{"event_id":"evt_9","type":"payment.confirmed","payment":{"id":"pay_900","tx_hash":"0x900","chain":"ethereum","asset":"USDC","amount":75,"confirmations":12}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac dev-webhook-secret | awk '{print $NF}')
curl -s localhost:3000/webhooks/chain -H 'content-type: application/json' -H "x-signature: $SIG" -d "$BODY"
```

## Interview talking points
- Why the raw body is signed, and why replay and out-of-order events are handled in the database.
- Why the model never gets write access: it requests, a human approves.
- How validation errors are fed back so a small model can recover, and how the eval measures it.
- Next steps: Redis cache for hot lookups, a queue for webhook processing, Prometheus metrics.
