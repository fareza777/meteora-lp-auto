import "server-only";
import { cookies, headers } from "next/headers";
import { PublicKey } from "@solana/web3.js";
import { getDb, nowMs } from "./db";
import { getConfig } from "./config";
import { createDefaultBotConfig, createDefaultSettings } from "./defaults";
import {
  isValidSolanaAddress,
  randomToken,
  sha256,
  verifyWalletSignature,
} from "./security";
import type { BotConfig, UserRecord, UserSettings } from "./types";

const SESSION_COOKIE = "tide_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 5 * 60 * 1000;

export type UserRow = {
  id: string;
  auth_wallet: string;
  display_name: string | null;
  created_at: number;
  last_seen_at: number;
  live_armed: number;
  live_armed_until: number | null;
  kill_switch: number;
};

const WELCOME_MESSAGE =
  "Tide LP wants you to authenticate with your Solana wallet. This signature proves ownership; it does not trigger a transaction or cost network fees.";

const ARM_MESSAGE =
  "By signing, you arm server-side live trading for 24 hours. Tide will be able to sign Meteora transactions with your encrypted execution wallet until this window expires or you hit the kill switch.";

export function canonicalWallet(wallet: string): string {
  return new PublicKey(wallet).toBase58();
}

export function buildAuthMessage(opts: {
  wallet: string;
  nonce: string;
  origin: string;
  issuedAt: number;
  expiresAt: number;
  purpose: "login" | "enable-live" | "emergency-exit";
}): string {
  const title = opts.purpose === "login" ? "Sign in to Tide" : "Tide safety confirmation";
  const statement = opts.purpose === "login" ? WELCOME_MESSAGE : ARM_MESSAGE;
  return [
    title,
    opts.origin,
    "",
    statement,
    "",
    `Wallet: ${opts.wallet}`,
    `Purpose: ${opts.purpose}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${new Date(opts.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(opts.expiresAt).toISOString()}`,
  ].join("\n");
}

export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  const protocol = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export function issueNonce(opts: {
  wallet: string;
  purpose: "login" | "enable-live" | "emergency-exit";
  origin: string;
  userId?: string;
}): { nonce: string; message: string; expiresAt: number } {
  const db = getDb();
  const nonce = randomToken(24);
  const issuedAt = nowMs();
  const expiresAt = issuedAt + NONCE_TTL_MS;
  const message = buildAuthMessage({
    wallet: opts.wallet,
    nonce,
    origin: opts.origin,
    issuedAt,
    expiresAt,
    purpose: opts.purpose,
  });
  db.prepare("DELETE FROM nonces WHERE expires_at < ?").run(issuedAt);
  db.prepare(
    "INSERT INTO nonces (nonce, wallet, purpose, user_id, message, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(nonce, opts.wallet, opts.purpose, opts.userId ?? null, message, expiresAt);
  return { nonce, message, expiresAt };
}

export function consumeNonce(opts: {
  nonce: string;
  wallet: string;
  purpose: "login" | "enable-live" | "emergency-exit";
  userId?: string;
}): { message: string; expiresAt: number } | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT message, expires_at, used_at, wallet, purpose, user_id FROM nonces WHERE nonce = ?",
    )
    .get(opts.nonce) as
    | {
        message: string;
        expires_at: number;
        used_at: number | null;
        wallet: string;
        purpose: string;
        user_id: string | null;
      }
    | undefined;
  if (
    !row ||
    row.used_at !== null ||
    row.expires_at < nowMs() ||
    row.wallet !== opts.wallet ||
    row.purpose !== opts.purpose ||
    (opts.userId && row.user_id !== opts.userId)
  ) {
    return null;
  }
  const consumed = db
    .prepare("UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL")
    .run(nowMs(), opts.nonce);
  if (consumed.changes !== 1) return null;
  return { message: row.message, expiresAt: row.expires_at };
}

function toUser(row: UserRow): UserRecord {
  const armedUntil = row.live_armed_until && row.live_armed_until > nowMs() ? row.live_armed_until : null;
  return {
    id: row.id,
    authWallet: row.auth_wallet,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    liveArmed: row.live_armed === 1 && armedUntil !== null,
    liveArmedUntil: armedUntil,
    killSwitch: row.kill_switch === 1,
  };
}

export function getUserById(id: string): UserRecord | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function ensureUserWorkspace(wallet: string): UserRecord {
  const db = getDb();
  const canonical = canonicalWallet(wallet);
  const now = nowMs();
  const existing = db.prepare("SELECT * FROM users WHERE auth_wallet = ?").get(canonical) as
    | UserRow
    | undefined;
  if (existing) {
    db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").run(now, existing.id);
    return toUser({ ...existing, last_seen_at: now });
  }

  const config = getConfig();
  const userId = crypto.randomUUID();
  const settings = createDefaultSettings();
  const botConfig = createDefaultBotConfig("balanced");
  const botId = crypto.randomUUID();

  const create = db.transaction(() => {
    db.prepare(
      "INSERT INTO users (id, auth_wallet, display_name, created_at, last_seen_at) VALUES (?, ?, NULL, ?, ?)",
    ).run(userId, canonical, now, now);
    db.prepare(
      "INSERT INTO paper_accounts (user_id, initial_capital, cash, peak_equity, day_start_equity, day_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      userId,
      config.paperStartingBalance,
      config.paperStartingBalance,
      config.paperStartingBalance,
      config.paperStartingBalance,
      new Date(now).toISOString().slice(0, 10),
      now,
    );
    db.prepare(
      "INSERT INTO settings (user_id, risk_json, notifications_json, telegram_token_enc, updated_at) VALUES (?, ?, ?, NULL, ?)",
    ).run(userId, JSON.stringify(settings.risk), JSON.stringify(settings.notifications), now);
    db.prepare(
      "INSERT INTO bots (id, user_id, name, status, mode, config_json, created_at, updated_at) VALUES (?, ?, ?, 'paused', 'paper', ?, ?, ?)",
    ).run(botId, userId, "Aurora", JSON.stringify(botConfig), now, now);
    db.prepare(
      "INSERT INTO equity_snapshots (id, user_id, ts, equity, cash, positions_value, pnl, fees) VALUES (?, ?, ?, ?, ?, 0, 0, 0)",
    ).run(crypto.randomUUID(), userId, now, config.paperStartingBalance, config.paperStartingBalance);
    db.prepare(
      "INSERT INTO activity_logs (id, user_id, bot_id, level, category, message, created_at) VALUES (?, ?, NULL, 'info', 'account', ?, ?)",
    ).run(
      crypto.randomUUID(),
      userId,
      `Paper portfolio initialised with $${config.paperStartingBalance.toLocaleString("en-US")}. Live trading is off.`,
      now,
    );
  });
  create();
  return getUserById(userId)!;
}

export async function createSession(userId: string, userAgent?: string | null): Promise<void> {
  const db = getDb();
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const now = nowMs();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare(
    "INSERT INTO sessions (id, token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(crypto.randomUUID(), tokenHash, userId, now, now + SESSION_TTL_MS, userAgent?.slice(0, 240) ?? null);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getConfig().cookieSecure,
    path: "/",
    expires: new Date(now + SESSION_TTL_MS),
  });
}

export async function getSessionUser(): Promise<UserRecord | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), nowMs()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  store.delete(SESSION_COOKIE);
}

export async function verifyLoginAndCreateSession(opts: {
  wallet: string;
  nonce: string;
  signature: string;
  userAgent?: string | null;
}): Promise<UserRecord | null> {
  if (!isValidSolanaAddress(opts.wallet)) return null;
  const canonical = canonicalWallet(opts.wallet);
  const consumed = consumeNonce({ nonce: opts.nonce, wallet: canonical, purpose: "login" });
  if (!consumed) return null;
  if (!verifyWalletSignature(canonical, consumed.message, opts.signature)) return null;
  const user = ensureUserWorkspace(canonical);
  await createSession(user.id, opts.userAgent);
  return user;
}

export function createActionNonce(user: UserRecord, purpose: "enable-live" | "emergency-exit", origin: string) {
  return issueNonce({ wallet: user.authWallet, purpose, origin, userId: user.id });
}

export function verifyActionSignature(opts: {
  user: UserRecord;
  purpose: "enable-live" | "emergency-exit";
  nonce: string;
  signature: string;
}): boolean {
  const consumed = consumeNonce({
    nonce: opts.nonce,
    wallet: opts.user.authWallet,
    purpose: opts.purpose,
    userId: opts.user.id,
  });
  if (!consumed) return false;
  return verifyWalletSignature(opts.user.authWallet, consumed.message, opts.signature);
}

export function armLiveTrading(userId: string): number {
  const until = nowMs() + 24 * 60 * 60 * 1000;
  getDb().prepare("UPDATE users SET live_armed = 1, live_armed_until = ? WHERE id = ?").run(until, userId);
  return until;
}

export function disarmLiveTrading(userId: string): void {
  getDb().prepare("UPDATE users SET live_armed = 0, live_armed_until = NULL WHERE id = ?").run(userId);
}

export function hasValidLiveArming(userId: string): boolean {
  const row = getDb()
    .prepare("SELECT live_armed, live_armed_until FROM users WHERE id = ?")
    .get(userId) as { live_armed: number; live_armed_until: number | null } | undefined;
  return Boolean(row?.live_armed === 1 && row.live_armed_until && row.live_armed_until > nowMs());
}

export function isKillSwitchActive(userId: string): boolean {
  const row = getDb().prepare("SELECT kill_switch FROM users WHERE id = ?").get(userId) as
    | { kill_switch: number }
    | undefined;
  return row?.kill_switch === 1;
}

export function setKillSwitch(userId: string, active: boolean): void {
  getDb().prepare("UPDATE users SET kill_switch = ? WHERE id = ?").run(active ? 1 : 0, userId);
  if (active) disarmLiveTrading(userId);
}

export type { BotConfig, UserSettings };
