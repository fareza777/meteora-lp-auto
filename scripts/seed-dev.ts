/**
 * Seeds an idempotent local demo workspace.
 *
 * Usage:
 *   npm run seed:dev
 *   npm run seed:dev -- --wallet <your-solana-address>
 *
 * By default it targets the same deterministic wallet as the one-click dev
 * login, so the seeded bots and paper book appear immediately after
 * "Continue in local demo mode".
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

function loadEnvFile(name: string) {
  const path = resolve(process.cwd(), name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

function devWallet(): string {
  return Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
}

function walletArgument(): string | null {
  const index = process.argv.indexOf("--wallet");
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value) {
    console.error("--wallet requires a Solana address.");
    process.exit(1);
  }
  return value;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Usage: npm run seed:dev [-- --wallet <solana-address>]",
        "",
        "Creates (or reuses) a paper-only demo workspace with three starter",
        "strategies. Nothing here can sign live transactions.",
      ].join("\n"),
    );
    return;
  }

  const { ensureUserWorkspace } = await import("../src/lib/auth");
  const { createBot, getBots, getPaperAccount, logActivity } = await import("../src/lib/store");
  const { createDefaultBotConfig } = await import("../src/lib/defaults");
  const { getDb } = await import("../src/lib/db");

  const wallet = walletArgument() ?? devWallet();
  const user = ensureUserWorkspace(wallet);
  const botNames = new Set(getBots(user.id).map((bot) => bot.name));

  const blueprints = [
    {
      name: "Aurora",
      profile: "balanced" as const,
      protocols: ["dlmm", "damm-v2"] as Array<"dlmm" | "damm-v2">,
      capital: 2_500,
      maxOpen: 4,
    },
    {
      name: "Coral",
      profile: "conservative" as const,
      protocols: ["dlmm"] as Array<"dlmm" | "damm-v2">,
      capital: 1_000,
      maxOpen: 2,
    },
    {
      name: "Nova",
      profile: "aggressive" as const,
      protocols: ["damm-v2"] as Array<"dlmm" | "damm-v2">,
      capital: 3_000,
      maxOpen: 3,
    },
  ];

  const created: string[] = [];
  for (const blueprint of blueprints) {
    if (botNames.has(blueprint.name)) continue;
    createBot(user.id, {
      name: blueprint.name,
      status: "paused",
      mode: "paper",
      config: {
        ...createDefaultBotConfig(blueprint.profile),
        protocols: blueprint.protocols,
        capitalPerPositionUsd: blueprint.capital,
        maxOpenPositions: blueprint.maxOpen,
      },
    });
    created.push(blueprint.name);
  }

  const account = getPaperAccount(user.id);
  logActivity({
    userId: user.id,
    level: "info",
    category: "account",
    message: created.length
      ? `Demo workspace seeded · ${created.join(", ")} ready in paper mode`
      : "Demo workspace verified · all starter strategies already present",
  });

  const bots = getBots(user.id);
  console.log("");
  console.log("  Tide demo workspace ready");
  console.log("  ─────────────────────────────────────────────");
  console.log(`  wallet       ${user.authWallet}`);
  console.log(`  paper cash   $${account.cash.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
  console.log(`  strategies   ${bots.map((bot) => `${bot.name} (${bot.config.riskProfile})`).join(", ")}`);
  console.log(`  new bots     ${created.length ? created.join(", ") : "none (already seeded)"}`);
  console.log("");
  if (walletArgument()) {
    console.log("  Next: log in with this wallet through the landing page.");
  } else {
    console.log("  Next: ensure DEV_LOGIN_ENABLED=true in .env.local, run `npm run dev`,");
    console.log('  then choose "Continue in local demo mode" on http://localhost:3000.');
  }
  console.log("  Live trading stays disabled until you arm it inside the app.");
  console.log("");

  getDb().close();
}

main().catch((error) => {
  console.error("");
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
