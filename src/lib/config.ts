import { z } from "zod";

const boolean = (value: string | undefined, fallback = false) =>
  value === undefined ? fallback : value.toLowerCase() === "true";

const envSchema = z.object({
  SESSION_SECRET: z.string().min(32).optional(),
  SIGNER_VAULT_KEY: z.string().min(32).optional(),
  DATABASE_PATH: z.string().default("./data/tide.db"),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  SOLANA_CLUSTER: z.enum(["mainnet-beta", "devnet"]).default("mainnet-beta"),
  ALLOW_PUBLIC_RPC_LIVE: z.string().optional(),
  METEORA_DLMM_API: z.string().url().default("https://dlmm.datapi.meteora.ag"),
  METEORA_DAMM_API: z.string().url().default("https://damm-v2.datapi.meteora.ag"),
  RUGCHECK_API: z.string().url().default("https://api.rugcheck.xyz"),
  JUPITER_API: z.string().url().default("https://lite-api.jup.ag"),
  LIVE_TRADING_ENABLED: z.string().optional(),
  PAPER_STARTING_BALANCE: z.coerce.number().positive().default(25_000),
  BOT_ENABLED: z.string().optional(),
  BOT_TICK_MS: z.coerce.number().min(5_000).max(300_000).default(20_000),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  COOKIE_SECURE: z.string().optional(),
});

export type ServerConfig = {
  sessionSecret: string;
  signerVaultKey: string;
  databasePath: string;
  rpcUrl: string;
  cluster: "mainnet-beta" | "devnet";
  allowPublicRpcLive: boolean;
  dlmmApi: string;
  dammApi: string;
  rugcheckApi: string;
  jupiterApi: string;
  liveGloballyEnabled: boolean;
  paperStartingBalance: number;
  botEnabled: boolean;
  botTickMs: number;
  telegramToken: string | undefined;
  telegramChatId: string | undefined;
  cookieSecure: boolean;
};

let cachedConfig: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (cachedConfig) return cachedConfig;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const env = parsed.data;
  const cookieSecureEnv = process.env.COOKIE_SECURE;
  cachedConfig = {
    sessionSecret: env.SESSION_SECRET ?? "",
    signerVaultKey: env.SIGNER_VAULT_KEY ?? "",
    databasePath: env.DATABASE_PATH,
    rpcUrl: env.SOLANA_RPC_URL,
    cluster: env.SOLANA_CLUSTER,
    allowPublicRpcLive: boolean(env.ALLOW_PUBLIC_RPC_LIVE),
    dlmmApi: env.METEORA_DLMM_API.replace(/\/$/, ""),
    dammApi: env.METEORA_DAMM_API.replace(/\/$/, ""),
    rugcheckApi: env.RUGCHECK_API.replace(/\/$/, ""),
    jupiterApi: env.JUPITER_API.replace(/\/$/, ""),
    liveGloballyEnabled: boolean(env.LIVE_TRADING_ENABLED),
    paperStartingBalance: env.PAPER_STARTING_BALANCE,
    botEnabled: boolean(env.BOT_ENABLED, true),
    botTickMs: env.BOT_TICK_MS,
    telegramToken: env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: env.TELEGRAM_CHAT_ID || undefined,
    cookieSecure:
      cookieSecureEnv !== undefined
        ? boolean(cookieSecureEnv)
        : process.env.NODE_ENV === "production",
  };
  return cachedConfig;
}

export function assertVaultConfigured() {
  const config = getConfig();
  if (!config.signerVaultKey || !config.sessionSecret) {
    throw new Error(
      "Server secrets are missing. Set SESSION_SECRET and SIGNER_VAULT_KEY in .env.local.",
    );
  }
}

const PUBLIC_RPC_HOSTS = new Set([
  "api.mainnet-beta.solana.com",
  "api.devnet.solana.com",
  "api.testnet.solana.com",
]);

export function validateLiveRpc(): { ok: boolean; reason?: string } {
  const config = getConfig();
  let host: string;
  try {
    host = new URL(config.rpcUrl).hostname;
  } catch {
    return { ok: false, reason: "RPC URL is invalid." };
  }
  if (PUBLIC_RPC_HOSTS.has(host) && !config.allowPublicRpcLive) {
    return {
      ok: false,
      reason:
        "A dedicated Solana RPC is required for live execution. Public RPCs are rate-limited and unsafe for automatic signing.",
    };
  }
  if (!config.rpcUrl.startsWith("https://") && process.env.NODE_ENV === "production") {
    return { ok: false, reason: "Live RPC must use HTTPS in production." };
  }
  return { ok: true };
}

export function isLiveGloballyEnabled(): boolean {
  return getConfig().liveGloballyEnabled;
}

export function resetConfigForTests() {
  cachedConfig = null;
}
