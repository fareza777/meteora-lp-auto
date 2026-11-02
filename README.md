# Tide — Meteora LP autopilot

A production-minded, self-hosted dashboard for automated **Meteora DLMM** liquidity on Solana, with
**DAMM v2** coverage for scanning, analysis, paper trading and backtesting. Tide pairs a live pool
scanner and strategy engine with paper-first bots, a hard-gated live executor and an encrypted
server-side signing wallet.

Everything is backed by the real indexed Meteora APIs, Jupiter prices and the official Meteora SDKs —
there is no mocked dashboard layer.

---

## Feature map

| Area | What ships |
| --- | --- |
| **Pool scanner** | Live DLMM + DAMM v2 pools ranked by opportunity score, fee APR, 24h fees/volume, TVL, volatility, holder base, token safety and profit consistency. Filters, protocol tabs, risk bands, search. |
| **Pool detail** | Interactive OHLCV candlesticks across 1D/7D/30D and 30m/1h/4h, SMA 20 / EMA 50 overlays, swing support and resistance, recommended-range band and OHLCV hover tooltip. Scroll or pinch to zoom, drag to pan, double-click or Reset to return to the full window. A technical read adds trend regression, RSI 14, ATR, volume trend, level distances and band fit with a plain-language summary. |
| **Strategy engine** | Volatility + fee analysis, risk score (0–100), risk flags, Spot / Curve / BidAsk recommendation, bin-range and width optimisation. Deterministic and unit-tested. |
| **Auto LP bots** | Multiple bots and strategies, interval-based scheduler, auto entry, out-of-range rebalance, stop-loss, take-profit, fee claims, compounding, pool rotation, daily loss and drawdown halts. |
| **Auto-improve guard** | Per-bot adaptive layer fed by closed trades: capital scaling, entry-score floors, rotation edge, rebalance grace, stop-loss pool cooldowns, strategy penalties with fallback and entry pauses on drawdown or loss streaks. |
| **Risk management** | RugCheck token safety, critical-flag blocking, per-pool and total exposure caps, per-trade and daily live notional limits, slippage and price-impact limits, stop-loss, drawdown halt, kill switch, emergency exit. |
| **Live execution** | Meteora DLMM open / close / claim through official SDK, Jupiter funding swaps, encrypted per-user hot wallet, 24-hour signed arming window, balance and rent preflight, on-chain confirmation, transaction records. |
| **Dashboard** | Equity curve, PnL, fee income, realised APR, impermanent loss, range health, wallet balances, live vs paper books, cost estimates, full transaction history. |
| **Backtesting** | Historical OHLCV backtests with the same risk rules, configurable strategy/range/fees and trade-by-trade results. |
| **Paper trading** | $25,000 default simulated book per user, continuous marking every 5 minutes, fee accrual, claims and closes. No wallet needed. |
| **Telegram** | Optional per-user bot with encrypted token, event notifications (entry, exit, risk, errors) and a UTC daily summary. |

---

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript strict
- SQLite (`better-sqlite3`, WAL) with a small typed store layer
- `@meteora-ag/dlmm`, `@meteora-ag/cp-amm-sdk`, `@solana/web3.js`, `@solana/spl-token`
- Meteora indexed APIs (`dlmm.datapi.meteora.ag`, `damm-v2.datapi.meteora.ag`), RugCheck, Jupiter Lite
- SWR + Recharts (equity/backtest) + a custom SVG candlestick engine + custom CSS design system (dark and light)
- Vitest for unit and engine tests

Node **22.12+** is required.

---

## Quickstart

```bash
npm install
cp .env.example .env.local       # Windows: copy .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SESSION_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # SIGNER_VAULT_KEY
npm run dev
```

Set `DEV_LOGIN_ENABLED=true` in `.env.local` for the local one-click wallet
(`POST /api/auth/dev`). In production, sign in with a Solana wallet signature instead; the dev route
returns 404 unless explicitly enabled outside production.

Optional demo fleet (idempotent, paused paper bots; same wallet as the dev login):

```bash
npm run seed:dev
# or target a wallet: npm run seed:dev -- --wallet <PUBKEY>
```

Reset the paper book (backs up `data/tide.db` to `data/backups/` first; live data, the execution
wallet and sessions are preserved):

```bash
npm run reset:paper -- --yes
# options: --wallet <PUBKEY> --balance 25000 --start Aurora
```

The reset clears paper positions, transactions, equity snapshots and trade activity, restores the
starting balance, resets bot runtime errors and restarts one strategy with auto-improve enabled.

Production:

```bash
npm run check      # typecheck + tests + production build
npm start
```

The bot scheduler starts through `src/instrumentation.ts` on the Node runtime. Tide is designed as a
**single-node** deployment: the scheduler, SQLite file and in-process locks assume one app instance.
Use Postgres and a real job queue before scaling horizontally.

---

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_SECRET` | — | 32+ chars. Session cookie signing. |
| `SIGNER_VAULT_KEY` | — | 32+ chars. HKDF input for AES-256-GCM execution-wallet encryption. |
| `DATABASE_PATH` | `./data/tide.db` | SQLite file. |
| `SOLANA_RPC_URL` | public mainnet | A **dedicated** HTTPS RPC is required for live signing. |
| `SOLANA_CLUSTER` | `mainnet-beta` | `mainnet-beta` or `devnet`. |
| `ALLOW_PUBLIC_RPC_LIVE` | `false` | Only set for deliberate test setups. Public RPC is rejected for live by default. |
| `LIVE_TRADING_ENABLED` | `false` | Server-wide live master switch. Paper trading is unaffected. |
| `PAPER_STARTING_BALANCE` | `25000` | Per-user simulated starting cash. |
| `BOT_ENABLED` | `true` | Run the in-process scheduler. |
| `BOT_TICK_MS` | `20000` | Scheduler tick, min 5s. |
| `DEV_LOGIN_ENABLED` | `false` | Local one-click wallet. Never enable in production. |
| `COOKIE_SECURE` | prod: `true` | Set explicitly when running behind HTTPS locally. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | — | Optional server-wide fallback; per-user config is encrypted in the DB. |
| `METEORA_DLMM_API` / `METEORA_DAMM_API` / `RUGCHECK_API` / `JUPITER_API` | official endpoints | Override only if you proxy them. |

Generate secrets once and keep them stable. Rotating `SIGNER_VAULT_KEY` makes existing execution
wallets undecryptable; rotating `SESSION_SECRET` logs every user out.

---

## Paper vs live

**Paper is the default everywhere.** Bots, manual entries and backtests use simulated books. No wallet
or network signature is involved.

Live execution requires **all** of the following, checked in order on every entry:

1. `LIVE_TRADING_ENABLED=true` on the server.
2. A dedicated RPC (`validateLiveRpc` rejects public endpoints).
3. The user's kill switch is clear.
4. An execution wallet exists and passes its public-key integrity check.
5. Live trading is armed with a wallet-signed, 24-hour message.
6. Pool eligibility passes the same filters as paper: TVL, pool age, holder base, risk score,
   opportunity score, fee APR, quote asset, verified mints, RugCheck safety and critical flags.
7. Position count, per-pool duplicate, per-trade cap and rolling daily notional limits pass.

Manual and bot live entries go through the same `openLiveDlmmPosition` path, so manual clicks cannot
skip the safety gate. Closing, claiming and withdrawing intentionally skip the arming requirement so
that emergency exits and fund recovery keep working after a halt or disarm.

### Performance guard

Auto-improve is enabled per bot (`autoImprove`, on by default) and re-evaluated from the last 14 days
of closed trades on every tick. The dashboard and Autopilot pages show the live state.

- **Heat**: hot / steady / cooling / cold from win rate, net PnL, stop-losses, loss streaks and
  drawdown. Cold or cooling books raise the entry-score floor, require a larger rotation edge and
  wait longer before rebalancing.
- **Sizing**: a capital scale between 0.25× and 1.1×, also reduced by the candidate pool's risk
  score. The bot's capital per position stays the upper bound.
- **Pool cooldowns**: a stop-loss blocks the same pool for 12 h (48 h after a repeat), and heavy
  losses or repeated zero-win trades block it for 24–72 h.
- **Strategy feedback**: after three trades, a losing strategy is penalised and can fall back
  (BidAsk → Spot → Curve). The override only applies while the bot strategy is `auto`.
- **Entry pauses**: 4 consecutive losses, severe drawdown or a daily-loss breach pauses new entries
  while stop-loss, take-profit, claims and rebalances keep working.

### Custody model

- Each user gets a fresh Solana keypair generated **server-side**.
- The 64-byte secret is encrypted with AES-256-GCM under a key derived (HKDF-SHA256) from
  `SIGNER_VAULT_KEY` plus the user id, then stored in SQLite. The plaintext secret is never returned
  by any API.
- The public key is stored alongside and re-checked after decryption on every signing operation.
- The wallet is a **hot wallet**. Fund only what you are prepared to risk. There is no export;
  withdrawal transfers assets to the wallet you signed in with, which is pinned server-side and
  cannot be changed by the browser.
- Close live positions, then use **Withdraw** on the Live console to sweep token balances and native
  SOL (minus a small fee reserve and token-account rent). Removing the wallet deletes the key, so
  withdraw first.

### Web security

- HttpOnly, SameSite session cookies backed by hashed tokens in SQLite.
- Wallet auth uses a nonce + ed25519 signature; nonces are single-use and expire.
- Every mutating route enforces same-origin + `x-tide-client: web` (CSRF), per-user rate limits,
  JSON size limits and Zod validation.
- API responses are `no-store`; production errors are generic and secrets are redacted from logs.
- Live arming is a separate signed message; the kill switch disarms instantly.
- Withdrawals are session-authenticated but destination-pinned to the authenticated wallet, so a
  stolen session cannot redirect funds elsewhere.

---

## Live runbook

1. Configure a dedicated RPC and set `LIVE_TRADING_ENABLED=true`; restart.
2. Open **Live**, create the encrypted execution wallet, copy its public address.
3. Fund it with SOL (fees/rent; at least `0.12` SOL, more if SOL is the quote asset) and quote
   tokens (USDC/USDT/SOL) for the position sizes you intend to run.
4. Set risk limits in **Settings** (per-trade, daily notional, max positions, slippage, stop-loss,
   drawdown).
5. Arm live trading (wallet signature, 24 h). Bots can also be started after arming.
6. Watch positions, activity and transaction records. Use **Kill switch** to halt bots and disarm;
   use **Emergency exit** to market-close every live position (close still works without arming).
7. To stop using live: close or exit positions, press **Withdraw**, verify the funds in your wallet,
   then optionally **Remove wallet**.

Operational notes:

- The scheduler ticks every 20 s by default; paper books are marked every 5 minutes; live positions
  sync at most once per minute. Daily summaries go out at 23:00 UTC.
- Live exits and claims use the official Meteora SDK and confirm on-chain before recording.
- All live entries preflight SOL reserve, token balances, ATA rent and Jupiter price impact.
- Back up `data/tide.db` (and `-wal`/`-shm` when running) or stop the process before copying.

---

## Testing

```bash
npm run test        # Vitest suite
npm run typecheck
npm run check       # all of the above + production build
```

The suite covers LP entry/mark/fee math, strategy thresholds and ranges, risk scoring and safety
merging, quote orientation and inversion, the signer vault, secret redaction, RPC gating, locks and
rate limits, request schemas, paper decision logic, the auto-improve guard, the backtest engine
(mocked market data) and the withdraw destination pin.

Not covered by automated tests: real on-chain DLMM execution, Jupiter swaps, RugCheck availability
and Telegram delivery. Validate those on devnet or with small live size before scaling up.

A Playwright-core QA harness and screenshots used during development live in `.qa/` and are not part
of the app runtime.

---

## Architecture

```
src/
  app/                 Next.js pages + API routes
  components/          Dashboard UI (shell, scanner, positions, bots, live, charts)
  instrumentation.ts   Starts the bot scheduler on the Node runtime
  lib/
    market/            Meteora indexed APIs, cache, Jupiter prices, RugCheck, orientation
    analytics/         LP math, volatility/strategy engine, scoring
    bot/               Scheduler, bot engine, risk gates
    trading/           Paper book, live DLMM executor, Solana/Jupiter helpers
    backtest/          Historical simulation engine
    store.ts, db.ts    Typed SQLite persistence
    auth.ts, security.ts, api.ts, schemas.ts, rate-limit.ts, config.ts
```

The UI reads through SWR against server routes; all state lives in SQLite. Market responses are
cached with stale-while-revalidate semantics to keep API/RPC usage low, and OHLCV requests are
chunked to respect the Meteora candle limits.

---

## Limitations

- Live execution supports **DLMM only**. DAMM v2 is fully supported for scanning, analysis, paper
  trading and backtesting.
- Single-process scheduler and SQLite; no horizontal scaling or multi-region execution.
- Strategies are deterministic heuristics, not an ML model. Scores and APRs are estimates.
- Token safety depends on RugCheck coverage; very new tokens may have little data.
- No tax, accounting or legal advice. Trading LP positions can lose money; use paper mode first.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Live stays “Locked” | Check the gate checklist: server flag, RPC, wallet, arming, kill switch. |
| “A dedicated Solana RPC is required” | Set `SOLANA_RPC_URL` to a private HTTPS provider, or `ALLOW_PUBLIC_RPC_LIVE=true` for test only. |
| “Execution wallet needs … SOL” | Top up the wallet; ATA rent and network fees are paid from it. |
| Bots do nothing | Bot must be running, scheduler enabled, risk checks passing and entry criteria met. Check Activity. |
| Telegram silent | Enable notifications, save a valid token, use “Send test”, verify the chat id. |
| Reset local data | Stop the app and delete `data/tide.db*`. This deletes all accounts and history. |
