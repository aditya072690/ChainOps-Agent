import { openDb } from "./db.js";
import { OpenAiCompatClient } from "./llm.js";
import { createApp } from "./server.js";
import { seed } from "./seed.js";

const db = await openDb(process.env.DATABASE_URL, process.env.DATABASE_URL ? undefined : ".pgdata");
if (process.env.SEED === "1") await seed(db);
const app = createApp({
  db, llm: new OpenAiCompatClient(),
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  adminKey: process.env.ADMIN_API_KEY ?? "dev-admin-key",
});
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`chainops-agent listening on :${port}`));
