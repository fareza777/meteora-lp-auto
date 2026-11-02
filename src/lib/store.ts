import "server-only";
import { getDb, nowMs } from "./db";
import { createDefaultBotConfig, createDefaultSettings, getProfileDefaults } from "./defaults";
import { decryptSensitiveString, encryptSensitiveString, redactSecrets } from "./security";
import type {
  ActivityRecord,
  BacktestConfig,
  BacktestRecord,
  BacktestResult,
  BotConfig,
  BotRecord,
  BotStatus,
  ExecutionWalletRecord,
  NotificationSettings,
  PaperAccount,
  PositionRecord,
  RiskSettings,
  TradingMode,
  TransactionRecord,
  UserSettings,
} from "./types";

type Row = Record<string, unknown>;

function str(row: Row, key: string, fallback = ""): string {
  const value = row[key];
  return typeof value === "string" ? value : fallback;
}

function num(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNum(row: Row, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableStr(row: Row, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getUserSettings(userId: string): UserSettings {
  const row = getDb().prepare("SELECT * FROM settings WHERE user_id = ?").get(userId) as Row | undefined;
  const defaults = createDefaultSettings();
  if (!row) return defaults;
  const risk = { ...defaults.risk, ...parseJson<Partial<RiskSettings>>(row.risk_json, {}) };
  const notifications = {
    ...defaults.notifications,
    ...parseJson<Partial<NotificationSettings>>(row.notifications_json, {}),
    hasToken: Boolean(row.telegram_token_enc),
  };
  return { risk, notifications };
}

export function saveSettings(userId: string, settings: UserSettings): void {
  getDb()
    .prepare("UPDATE settings SET risk_json = ?, notifications_json = ?, updated_at = ? WHERE user_id = ?")
    .run(JSON.stringify(settings.risk), JSON.stringify(settings.notifications), nowMs(), userId);
}

export function saveTelegramToken(userId: string, token: string | null): void {
  const encrypted = token ? encryptSensitiveString(token, userId) : null;
  getDb().prepare("UPDATE settings SET telegram_token_enc = ?, updated_at = ? WHERE user_id = ?").run(
    encrypted,
    nowMs(),
    userId,
  );
}

export function readTelegramToken(userId: string): string | null {
  const row = getDb().prepare("SELECT telegram_token_enc FROM settings WHERE user_id = ?").get(userId) as
    | Row
    | undefined;
  const encrypted = row?.telegram_token_enc;
  if (typeof encrypted !== "string") return null;
  try {
    return decryptSensitiveString(encrypted, userId);
  } catch {
    return null;
  }
}

export function updateRiskSettings(userId: string, risk: RiskSettings): void {
  const current = getUserSettings(userId);
  saveSettings(userId, { ...current, risk });
}

export function applyRiskProfile(userId: string, profile: "conservative" | "balanced" | "aggressive"): UserSettings {
  const current = getUserSettings(userId);
  const defaults = getProfileDefaults(profile);
  const next = { ...current, risk: defaults.risk };
  saveSettings(userId, next);
  return next;
}

export function getPaperAccount(userId: string): PaperAccount {
  const row = getDb().prepare("SELECT * FROM paper_accounts WHERE user_id = ?").get(userId) as Row | undefined;
  if (!row) throw new Error("Paper account not found.");
  return {
    userId,
    initialCapital: num(row, "initial_capital"),
    cash: num(row, "cash"),
    peakEquity: num(row, "peak_equity"),
    dayStartEquity: num(row, "day_start_equity"),
    dayKey: str(row, "day_key"),
    updatedAt: num(row, "updated_at"),
  };
}

export function savePaperAccount(account: PaperAccount): void {
  getDb()
    .prepare(
      `UPDATE paper_accounts SET cash = ?, peak_equity = ?, day_start_equity = ?, day_key = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      account.cash,
      account.peakEquity,
      account.dayStartEquity,
      account.dayKey,
      nowMs(),
      account.userId,
    );
}

export function getBots(userId: string): BotRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as Row[];
  return rows.map(botFromRow);
}

export function getBot(userId: string, botId: string): BotRecord | null {
  const row = getDb().prepare("SELECT * FROM bots WHERE id = ? AND user_id = ?").get(botId, userId) as
    | Row
    | undefined;
  return row ? botFromRow(row) : null;
}

function botFromRow(row: Row): BotRecord {
  const defaults = createDefaultBotConfig("balanced");
  const rawConfig = parseJson<Partial<BotConfig>>(row.config_json, {});
  const config = { ...defaults, ...rawConfig };
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    name: str(row, "name", "Autopilot"),
    status: (str(row, "status", "paused") as BotStatus) ?? "paused",
    mode: (str(row, "mode", "paper") as TradingMode) ?? "paper",
    config,
    lastRunAt: nullableNum(row, "last_run_at"),
    lastError: nullableStr(row, "last_error"),
    createdAt: num(row, "created_at"),
    updatedAt: num(row, "updated_at"),
  };
}

export function createBot(
  userId: string,
  input: { name: string; status: BotStatus; mode: TradingMode; config: BotConfig },
): BotRecord {
  const id = crypto.randomUUID();
  const now = nowMs();
  getDb()
    .prepare(
      `INSERT INTO bots (id, user_id, name, status, mode, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, input.name, input.status, input.mode, JSON.stringify(input.config), now, now);
  return getBot(userId, id)!;
}

export function saveBot(bot: BotRecord): void {
  getDb()
    .prepare(
      `UPDATE bots SET name = ?, status = ?, mode = ?, config_json = ?, last_run_at = ?, last_error = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      bot.name,
      bot.status,
      bot.mode,
      JSON.stringify(bot.config),
      bot.lastRunAt,
      bot.lastError,
      nowMs(),
      bot.id,
      bot.userId,
    );
}

export function updateBotRun(
  botId: string,
  input: { lastRunAt?: number; lastError?: string | null; status?: BotStatus },
): void {
  const current = getDb().prepare("SELECT * FROM bots WHERE id = ?").get(botId) as Row | undefined;
  if (!current) return;
  getDb()
    .prepare("UPDATE bots SET last_run_at = ?, last_error = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(
      input.lastRunAt ?? nullableNum(current, "last_run_at"),
      input.lastError === undefined ? nullableStr(current, "last_error") : input.lastError,
      input.status ?? str(current, "status", "paused"),
      nowMs(),
      botId,
    );
}

export function deleteBot(userId: string, botId: string): void {
  getDb().prepare("DELETE FROM bots WHERE id = ? AND user_id = ? AND mode = 'paper'").run(botId, userId);
}

export function getRunningBots(): BotRecord[] {
  const rows = getDb().prepare("SELECT * FROM bots WHERE status = 'running'").all() as Row[];
  return rows.map(botFromRow);
}

export function getAllBots(): BotRecord[] {
  const rows = getDb().prepare("SELECT * FROM bots ORDER BY created_at ASC").all() as Row[];
  return rows.map(botFromRow);
}

export function getExecutionWallet(userId: string): ExecutionWalletRecord | null {
  const row = getDb().prepare("SELECT * FROM execution_wallets WHERE user_id = ?").get(userId) as
    | Row
    | undefined;
  if (!row) return null;
  return {
    userId: str(row, "user_id"),
    pubkey: str(row, "pubkey"),
    createdAt: num(row, "created_at"),
    updatedAt: num(row, "updated_at"),
  };
}

export function storeExecutionWallet(
  userId: string,
  pubkey: string,
  encryptedSecret: string,
): ExecutionWalletRecord {
  const now = nowMs();
  getDb()
    .prepare(
      `INSERT INTO execution_wallets (user_id, pubkey, encrypted_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET pubkey = excluded.pubkey,
         encrypted_secret = excluded.encrypted_secret, updated_at = excluded.updated_at`,
    )
    .run(userId, pubkey, encryptedSecret, now, now);
  return getExecutionWallet(userId)!;
}

export function getEncryptedExecutionSecret(userId: string): string | null {
  const row = getDb().prepare("SELECT encrypted_secret FROM execution_wallets WHERE user_id = ?").get(userId) as
    | Row
    | undefined;
  return typeof row?.encrypted_secret === "string" ? row.encrypted_secret : null;
}

export function removeExecutionWallet(userId: string): void {
  getDb().prepare("DELETE FROM execution_wallets WHERE user_id = ?").run(userId);
}

export function positionFromRow(row: Row): PositionRecord {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    botId: nullableStr(row, "bot_id"),
    mode: str(row, "mode", "paper") as TradingMode,
    protocol: str(row, "protocol", "dlmm") as PositionRecord["protocol"],
    poolAddress: str(row, "pool_address"),
    poolName: str(row, "pool_name"),
    strategy: str(row, "strategy", "Spot") as PositionRecord["strategy"],
    status: str(row, "status", "open") as PositionRecord["status"],
    capitalUsd: num(row, "capital_usd"),
    entryPrice: num(row, "entry_price"),
    currentPrice: num(row, "current_price"),
    lowerBin: num(row, "lower_bin"),
    upperBin: num(row, "upper_bin"),
    lowerPrice: num(row, "lower_price"),
    upperPrice: num(row, "upper_price"),
    tokenXMint: str(row, "token_x_mint"),
    tokenYMint: str(row, "token_y_mint"),
    tokenXSymbol: str(row, "token_x_symbol"),
    tokenYSymbol: str(row, "token_y_symbol"),
    tokenXDecimals: num(row, "token_x_decimals"),
    tokenYDecimals: num(row, "token_y_decimals"),
    entryXAmount: num(row, "entry_x_amount"),
    entryYAmount: num(row, "entry_y_amount"),
    currentXAmount: num(row, "current_x_amount"),
    currentYAmount: num(row, "current_y_amount"),
    tokenXPriceUsd: num(row, "token_x_price_usd"),
    tokenYPriceUsd: num(row, "token_y_price_usd"),
    currentValueUsd: num(row, "current_value_usd"),
    feeDailyPct: num(row, "fee_daily_pct"),
    unclaimedFeesUsd: num(row, "unclaimed_fees_usd"),
    claimedFeesUsd: num(row, "claimed_fees_usd"),
    ilUsd: num(row, "il_usd"),
    pnlUsd: num(row, "pnl_usd"),
    pnlPct: num(row, "pnl_pct"),
    inRange: num(row, "in_range", 1) === 1,
    outOfRangeSince: nullableNum(row, "out_of_range_since"),
    lastClaimedAt: nullableNum(row, "last_claimed_at"),
    positionAddress: nullableStr(row, "position_address"),
    nftMint: nullableStr(row, "nft_mint"),
    openedAt: num(row, "opened_at"),
    lastAccruedAt: num(row, "last_accrued_at"),
    updatedAt: num(row, "updated_at"),
    closedAt: nullableNum(row, "closed_at"),
    closeReason: nullableStr(row, "close_reason"),
    closeProceedsUsd: nullableNum(row, "close_proceeds_usd"),
    txOpen: nullableStr(row, "tx_open"),
    txClose: nullableStr(row, "tx_close"),
  };
}

export function getPositions(
  userId: string,
  opts: { mode?: TradingMode; status?: "open" | "closed"; limit?: number } = {},
): PositionRecord[] {
  const clauses = ["user_id = ?"];
  const params: unknown[] = [userId];
  if (opts.mode) {
    clauses.push("mode = ?");
    params.push(opts.mode);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  const limit = Math.min(opts.limit ?? 500, 1_000);
  const rows = getDb()
    .prepare(`SELECT * FROM positions WHERE ${clauses.join(" AND ")} ORDER BY opened_at DESC LIMIT ${limit}`)
    .all(...params) as Row[];
  return rows.map(positionFromRow);
}

export function getPosition(userId: string, id: string): PositionRecord | null {
  const row = getDb().prepare("SELECT * FROM positions WHERE id = ? AND user_id = ?").get(id, userId) as
    | Row
    | undefined;
  return row ? positionFromRow(row) : null;
}

export function getOpenPositionsForPool(poolAddress: string): PositionRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM positions WHERE pool_address = ? AND status = 'open'")
    .all(poolAddress) as Row[];
  return rows.map(positionFromRow);
}

export function getAllOpenPositions(): PositionRecord[] {
  const rows = getDb().prepare("SELECT * FROM positions WHERE status = 'open'").all() as Row[];
  return rows.map(positionFromRow);
}

export function updatePosition(id: string, fields: Partial<Record<string, string | number | null>>): void {
  const allowed = new Set([
    "current_price",
    "lower_bin",
    "upper_bin",
    "lower_price",
    "upper_price",
    "entry_x_amount",
    "entry_y_amount",
    "current_x_amount",
    "current_y_amount",
    "token_x_price_usd",
    "token_y_price_usd",
    "current_value_usd",
    "fee_daily_pct",
    "unclaimed_fees_usd",
    "claimed_fees_usd",
    "il_usd",
    "pnl_usd",
    "pnl_pct",
    "in_range",
    "out_of_range_since",
    "last_claimed_at",
    "position_address",
    "nft_mint",
    "last_accrued_at",
    "updated_at",
    "status",
    "closed_at",
    "close_reason",
    "close_proceeds_usd",
    "tx_open",
    "tx_close",
    "strategy",
    "capital_usd",
  ]);
  const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE positions SET ${assignments} WHERE id = ?`)
    .run(...entries.map(([, value]) => value), id);
}

export function insertPosition(record: Omit<PositionRecord, "id"> & { id?: string }): PositionRecord {
  const id = record.id ?? crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO positions (
        id, user_id, bot_id, mode, protocol, pool_address, pool_name, strategy, status,
        capital_usd, entry_price, current_price, lower_bin, upper_bin, lower_price, upper_price,
        token_x_mint, token_y_mint, token_x_symbol, token_y_symbol, token_x_decimals, token_y_decimals,
        entry_x_amount, entry_y_amount, current_x_amount, current_y_amount,
        token_x_price_usd, token_y_price_usd, current_value_usd, fee_daily_pct,
        unclaimed_fees_usd, claimed_fees_usd, il_usd, pnl_usd, pnl_pct, in_range, out_of_range_since,
        last_claimed_at, position_address, nft_mint, opened_at, last_accrued_at, updated_at,
        closed_at, close_reason, close_proceeds_usd, tx_open, tx_close
      ) VALUES (
        @id, @user_id, @bot_id, @mode, @protocol, @pool_address, @pool_name, @strategy, @status,
        @capital_usd, @entry_price, @current_price, @lower_bin, @upper_bin, @lower_price, @upper_price,
        @token_x_mint, @token_y_mint, @token_x_symbol, @token_y_symbol, @token_x_decimals, @token_y_decimals,
        @entry_x_amount, @entry_y_amount, @current_x_amount, @current_y_amount,
        @token_x_price_usd, @token_y_price_usd, @current_value_usd, @fee_daily_pct,
        @unclaimed_fees_usd, @claimed_fees_usd, @il_usd, @pnl_usd, @pnl_pct, @in_range, @out_of_range_since,
        @last_claimed_at, @position_address, @nft_mint, @opened_at, @last_accrued_at, @updated_at,
        @closed_at, @close_reason, @close_proceeds_usd, @tx_open, @tx_close
      )`,
    )
    .run({
      id,
      user_id: record.userId,
      bot_id: record.botId,
      mode: record.mode,
      protocol: record.protocol,
      pool_address: record.poolAddress,
      pool_name: record.poolName,
      strategy: record.strategy,
      status: record.status,
      capital_usd: record.capitalUsd,
      entry_price: record.entryPrice,
      current_price: record.currentPrice,
      lower_bin: record.lowerBin,
      upper_bin: record.upperBin,
      lower_price: record.lowerPrice,
      upper_price: record.upperPrice,
      token_x_mint: record.tokenXMint,
      token_y_mint: record.tokenYMint,
      token_x_symbol: record.tokenXSymbol,
      token_y_symbol: record.tokenYSymbol,
      token_x_decimals: record.tokenXDecimals,
      token_y_decimals: record.tokenYDecimals,
      entry_x_amount: record.entryXAmount,
      entry_y_amount: record.entryYAmount,
      current_x_amount: record.currentXAmount,
      current_y_amount: record.currentYAmount,
      token_x_price_usd: record.tokenXPriceUsd,
      token_y_price_usd: record.tokenYPriceUsd,
      current_value_usd: record.currentValueUsd,
      fee_daily_pct: record.feeDailyPct,
      unclaimed_fees_usd: record.unclaimedFeesUsd,
      claimed_fees_usd: record.claimedFeesUsd,
      il_usd: record.ilUsd,
      pnl_usd: record.pnlUsd,
      pnl_pct: record.pnlPct,
      in_range: record.inRange ? 1 : 0,
      out_of_range_since: record.outOfRangeSince,
      last_claimed_at: record.lastClaimedAt,
      position_address: record.positionAddress,
      nft_mint: record.nftMint,
      opened_at: record.openedAt,
      last_accrued_at: record.lastAccruedAt,
      updated_at: record.updatedAt,
      closed_at: record.closedAt,
      close_reason: record.closeReason,
      close_proceeds_usd: record.closeProceedsUsd,
      tx_open: record.txOpen,
      tx_close: record.txClose,
    });
  return getPosition(record.userId, id)!;
}

export function logActivity(input: {
  userId: string;
  botId?: string | null;
  level: ActivityRecord["level"];
  category: string;
  message: string;
  metadata?: Record<string, unknown> | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO activity_logs (id, user_id, bot_id, level, category, message, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      input.userId,
      input.botId ?? null,
      input.level,
      input.category,
      redactSecrets(input.message).slice(0, 1_000),
      input.metadata ? JSON.stringify(input.metadata) : null,
      nowMs(),
    );
}

export function getActivity(userId: string, limit = 80): ActivityRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM activity_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, Math.min(limit, 500)) as Row[];
  return rows.map((row) => ({
    id: str(row, "id"),
    userId: str(row, "user_id"),
    botId: nullableStr(row, "bot_id"),
    level: str(row, "level", "info") as ActivityRecord["level"],
    category: str(row, "category"),
    message: str(row, "message"),
    metadata: parseJson<Record<string, unknown> | null>(row.metadata_json, null),
    createdAt: num(row, "created_at"),
  }));
}

export function recordTransaction(input: {
  userId: string;
  botId?: string | null;
  positionId?: string | null;
  mode: TradingMode;
  type: string;
  status: TransactionRecord["status"];
  signature?: string | null;
  amountUsd?: number;
  feeUsd?: number;
  networkFeeUsd?: number;
  poolName?: string | null;
  metadata?: Record<string, unknown> | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO transactions (
        id, user_id, bot_id, position_id, mode, type, status, signature, amount_usd,
        fee_usd, network_fee_usd, pool_name, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      input.userId,
      input.botId ?? null,
      input.positionId ?? null,
      input.mode,
      input.type,
      input.status,
      input.signature ?? null,
      input.amountUsd ?? 0,
      input.feeUsd ?? 0,
      input.networkFeeUsd ?? 0,
      input.poolName ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      nowMs(),
    );
}

export function getTransactions(userId: string, limit = 60): TransactionRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, Math.min(limit, 300)) as Row[];
  return rows.map((row) => ({
    id: str(row, "id"),
    userId: str(row, "user_id"),
    botId: nullableStr(row, "bot_id"),
    positionId: nullableStr(row, "position_id"),
    mode: str(row, "mode", "paper") as TradingMode,
    type: str(row, "type"),
    status: str(row, "status", "simulated") as TransactionRecord["status"],
    signature: nullableStr(row, "signature"),
    amountUsd: num(row, "amount_usd"),
    feeUsd: num(row, "fee_usd"),
    networkFeeUsd: num(row, "network_fee_usd"),
    poolName: nullableStr(row, "pool_name"),
    metadata: parseJson<Record<string, unknown> | null>(row.metadata_json, null),
    createdAt: num(row, "created_at"),
  }));
}

export function recordEquitySnapshot(input: {
  userId: string;
  ts?: number;
  equity: number;
  cash: number;
  positionsValue: number;
  pnl: number;
  fees: number;
}): void {
  const ts = input.ts ?? nowMs();
  const db = getDb();
  const last = db
    .prepare("SELECT ts FROM equity_snapshots WHERE user_id = ? ORDER BY ts DESC LIMIT 1")
    .get(input.userId) as { ts: number } | undefined;
  if (last && ts - last.ts < 60_000) {
    db.prepare(
      "UPDATE equity_snapshots SET ts = ?, equity = ?, cash = ?, positions_value = ?, pnl = ?, fees = ? WHERE user_id = ? AND ts = ?",
    ).run(ts, input.equity, input.cash, input.positionsValue, input.pnl, input.fees, input.userId, last.ts);
  } else {
    db.prepare(
      "INSERT INTO equity_snapshots (id, user_id, ts, equity, cash, positions_value, pnl, fees) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      crypto.randomUUID(),
      input.userId,
      ts,
      input.equity,
      input.cash,
      input.positionsValue,
      input.pnl,
      input.fees,
    );
  }
}

export function getEquitySnapshots(userId: string, since = nowMs() - 30 * 86_400_000) {
  const rows = getDb()
    .prepare(
      "SELECT ts, equity, cash, positions_value, pnl, fees FROM equity_snapshots WHERE user_id = ? AND ts >= ? ORDER BY ts ASC LIMIT 5000",
    )
    .all(userId, since) as Row[];
  return rows.map((row) => ({
    ts: num(row, "ts"),
    equity: num(row, "equity"),
    cash: num(row, "cash"),
    positionsValue: num(row, "positions_value"),
    pnl: num(row, "pnl"),
    fees: num(row, "fees"),
  }));
}

export function getBotStats(userId: string) {
  const rows = getDb()
    .prepare(
      `SELECT b.id AS bot_id, b.last_run_at,
        SUM(CASE WHEN p.status = 'open' THEN 1 ELSE 0 END) AS open_positions,
        SUM(CASE WHEN p.status = 'closed' THEN 1 ELSE 0 END) AS closed_positions,
        COALESCE(SUM(p.pnl_usd), 0) AS net_pnl,
        COALESCE(SUM(p.claimed_fees_usd + CASE WHEN p.status = 'open' THEN p.unclaimed_fees_usd ELSE 0 END), 0) AS fees,
        SUM(CASE WHEN p.status = 'closed' AND p.pnl_usd > 0 THEN 1 ELSE 0 END) AS wins
       FROM bots b LEFT JOIN positions p ON p.bot_id = b.id
       WHERE b.user_id = ? GROUP BY b.id`,
    )
    .all(userId) as Row[];
  return rows.map((row) => {
    const closed = num(row, "closed_positions");
    return {
      botId: str(row, "bot_id"),
      openPositions: num(row, "open_positions"),
      closedPositions: closed,
      netPnl: num(row, "net_pnl"),
      fees: num(row, "fees"),
      winRate: closed > 0 ? (num(row, "wins") / closed) * 100 : 0,
      lastRunAt: nullableNum(row, "last_run_at"),
    };
  });
}

export function getAllUserIds(): string[] {
  const rows = getDb().prepare("SELECT id FROM users").all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function countOpenLivePositions(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM positions WHERE user_id = ? AND mode = 'live' AND status = 'open'")
    .get(userId) as { count: number } | undefined;
  return row ? Number(row.count) : 0;
}

export function liveNotionalSince(userId: string, since: number): number {
  const row = getDb()
    .prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM transactions WHERE user_id = ? AND mode = 'live' AND type = 'open' AND created_at >= ?",
    )
    .get(userId, since) as { total: number } | undefined;
  return row ? Number(row.total) : 0;
}

export function getLastClosedPositionForPool(userId: string, poolAddress: string): PositionRecord | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM positions WHERE user_id = ? AND pool_address = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT 1",
    )
    .get(userId, poolAddress) as Row | undefined;
  return row ? positionFromRow(row) : null;
}

export function getOpenPositionByAddress(userId: string, positionAddress: string): PositionRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM positions WHERE user_id = ? AND position_address = ? AND status = 'open' LIMIT 1")
    .get(userId, positionAddress) as Row | undefined;
  return row ? positionFromRow(row) : null;
}

export function deleteBotForUser(userId: string, botId: string): boolean {
  const result = getDb()
    .prepare("DELETE FROM bots WHERE id = ? AND user_id = ? AND mode = 'paper'")
    .run(botId, userId);
  return result.changes > 0;
}

export function pauseAllBots(userId: string): number {
  const result = getDb()
    .prepare("UPDATE bots SET status = 'paused', updated_at = ? WHERE user_id = ? AND status = 'running'")
    .run(nowMs(), userId);
  return result.changes;
}

export function getLastClosedPositions(userId: string, limit = 20): PositionRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM positions WHERE user_id = ? AND status = 'closed' ORDER BY closed_at DESC LIMIT ?")
    .all(userId, limit) as Row[];
  return rows.map(positionFromRow);
}

function backtestFromRow(row: Row): BacktestRecord {
  return {
    id: str(row, "id"),
    userId: str(row, "user_id"),
    poolName: str(row, "pool_name"),
    protocol: str(row, "protocol", "dlmm") as BacktestRecord["protocol"],
    createdAt: num(row, "created_at"),
    config: parseJson<BacktestConfig>(row.config_json, {} as BacktestConfig),
    result: parseJson<BacktestResult>(row.result_json, {} as BacktestResult),
  };
}

export function saveBacktest(
  userId: string,
  input: {
    poolName: string;
    protocol: BacktestRecord["protocol"];
    config: BacktestConfig;
    result: BacktestResult;
  },
): BacktestRecord {
  const id = crypto.randomUUID();
  getDb()
    .prepare(
      `INSERT INTO backtests (id, user_id, pool_name, protocol, config_json, result_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      input.poolName,
      input.protocol,
      JSON.stringify(input.config),
      JSON.stringify(input.result),
      nowMs(),
    );
  return getBacktest(userId, id)!;
}

export function getBacktest(userId: string, id: string): BacktestRecord | null {
  const row = getDb().prepare("SELECT * FROM backtests WHERE id = ? AND user_id = ?").get(id, userId) as
    | Row
    | undefined;
  return row ? backtestFromRow(row) : null;
}

export function getBacktests(userId: string, limit = 20): BacktestRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM backtests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, Math.min(limit, 100)) as Row[];
  return rows.map(backtestFromRow);
}
