import type { Db } from "./db.js";

export async function seed(db: Db) {
  const rows: [string, string, string, string, number, string, number][] = [
    ["pay_001", "0xa1f3c9", "ethereum", "USDC", 250, "confirmed", 24],
    ["pay_002", "0xb77e12", "polygon", "USDC", 90.5, "confirmed", 64],
    ["pay_003", "0xc0d8aa", "ethereum", "ETH", 1.2, "pending", 2],
    ["pay_004", "0xd44f90", "solana", "USDC", 40, "failed", 0],
    ["pay_005", "0xe91b05", "polygon", "USDT", 600, "confirmed", 80],
    ["pay_006", "0xf2a6d7", "ethereum", "USDC", 15, "failed", 0],
  ];
  for (const r of rows)
    await db.query("INSERT INTO payments (id,tx_hash,chain,asset,amount,status,confirmations) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", r);
}
