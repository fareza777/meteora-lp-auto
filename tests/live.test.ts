import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { getDb, nowMs } from "@/lib/db";
import { LiveError, withdrawExecutionFunds } from "@/lib/trading/live";

function createUser(authWallet: string): string {
  const id = randomUUID();
  const now = nowMs();
  getDb()
    .prepare(
      "INSERT INTO users (id, auth_wallet, display_name, created_at, last_seen_at, live_armed, live_armed_until, kill_switch) VALUES (?, ?, NULL, ?, ?, 0, NULL, 0)",
    )
    .run(id, authWallet, now, now);
  return id;
}

describe("withdrawExecutionFunds", () => {
  it("rejects a destination that is not the authenticated wallet", async () => {
    const userId = createUser(Keypair.generate().publicKey.toBase58());
    await expect(
      withdrawExecutionFunds({ userId, destination: Keypair.generate().publicKey.toBase58() }),
    ).rejects.toThrow(/signed in with/);
  });

  it("rejects unknown accounts", async () => {
    await expect(
      withdrawExecutionFunds({
        userId: randomUUID(),
        destination: Keypair.generate().publicKey.toBase58(),
      }),
    ).rejects.toBeInstanceOf(LiveError);
  });

  it("requires an execution wallet before any on-chain work", async () => {
    const authWallet = Keypair.generate().publicKey.toBase58();
    const userId = createUser(authWallet);
    await expect(withdrawExecutionFunds({ userId, destination: authWallet })).rejects.toThrow(
      /Create an execution wallet first/,
    );
  });
});
