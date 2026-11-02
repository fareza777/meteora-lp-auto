"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Coins,
  Gauge,
  Percent,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { PoolAnalysis, TradingMode } from "@/lib/types";
import { fmtCompact, fmtCountdown, fmtPct, fmtUsd, pctOf, timeAgo } from "@/lib/client/format";
import { useDashboard, useRefreshAll } from "@/lib/client/hooks";
import { improveHeatLabel, improveHeatTone } from "@/lib/bot/improve";
import { RISK_PROFILE_COPY } from "@/lib/defaults";
import { PageError, PageLoading } from "@/components/page-states";
import {
  AnimatedNumber,
  Badge,
  Button,
  EmptyState,
  Panel,
  Segmented,
  Stat,
} from "@/components/ui";
import { EquityChart } from "@/components/charts";
import { PoolDrawer, type PoolSelection } from "@/components/market/pool-drawer";
import { PoolPair, ProtocolBadge, TokenIcon } from "@/components/market/pool-visuals";
import { LiveStatusCard } from "@/components/live/live-status-card";
import { EmergencyExitModal } from "@/components/live/emergency-exit";
import { useToast } from "@/components/toast";

type Range = "24h" | "7d" | "30d" | "all";

const RANGE_MS: Record<Exclude<Range, "all">, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

function deltaPoints(value: number): string {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)} pts`;
}

function Bar({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color?: string;
}) {
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="progress">
        <span
          style={{
            width: `${Math.min(100, Math.max(0, percent))}%`,
            background: color ?? "var(--accent)",
          }}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const { data, error, isLoading, mutate } = useDashboard();
  const [mode, setMode] = useState<TradingMode>("paper");
  const [range, setRange] = useState<Range>("7d");
  const [selected, setSelected] = useState<PoolSelection | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const summary = mode === "live" ? data?.liveSummary : data?.summary;

  const chartPoints = useMemo(() => {
    const curve = data?.equityCurve ?? [];
    if (!curve.length || range === "all") return curve;
    const cutoff = Date.now() - RANGE_MS[range];
    const filtered = curve.filter((point) => point.ts >= cutoff);
    return filtered.length >= 2 ? filtered : curve.slice(-2);
  }, [data?.equityCurve, range]);

  if (isLoading && !data) return <PageLoading label="Loading the command desk" />;
  if (!data || !summary) {
    return (
      <PageError
        title="The desk could not load"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => mutate()}
      />
    );
  }

  const risk = data.settings.risk;
  const improvement = mode === "live" ? data.liveImprovement : data.improvement;
  const openPositions = data.positions.filter(
    (position) => position.mode === mode && position.status === "open",
  );
  const openPnl = openPositions.reduce((sum, position) => sum + position.pnlUsd, 0);
  const liveReady = data.liveReadiness.canTrade;
  const runningBots = data.bots.filter((bot) => bot.status === "running").length;
  const fleet = data.bots.filter((bot) => !bot.name.startsWith("Manual desk"));
  const topPools = data.market.topPools.slice(0, 3);
  const composition = [
    { label: "Wallet value", value: summary.cash, color: "var(--cyan)" },
    { label: "Open positions", value: summary.positionsValue, color: "var(--accent)" },
    { label: "Unclaimed fees", value: summary.unclaimedFees, color: "var(--amber)" },
  ];

  function openPool(analysis: PoolAnalysis) {
    setSelected({ protocol: analysis.pool.protocol, address: analysis.pool.address });
  }

  async function refreshNow() {
    setRefreshing(true);
    try {
      await refreshAll();
      toast.success("Desk refreshed");
    } catch {
      toast.error("Refresh failed", "The server did not answer. Try again shortly.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="lede">
          <div className="row gap8 wrap">
            <span className="eyebrow">Command desk</span>
            <Badge tone="accent" dot>
              Paper first
            </Badge>
            {runningBots > 0 ? (
              <Badge tone="green" dot>
                {runningBots} bot{runningBots === 1 ? "" : "s"} running
              </Badge>
            ) : (
              <Badge tone="neutral">Autopilot idle</Badge>
            )}
          </div>
          <h1 className="h1 mt8">Your liquidity desk</h1>
          <p className="sub mt8">
            Live router data, transparent risk and a paper-first autopilot. Nothing reaches mainnet
            until you arm it.
          </p>
        </div>
        <div className="page-actions">
          <Segmented<TradingMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "paper", label: "Paper", count: data.summary.openPositions },
              { value: "live", label: "Live", count: data.liveSummary.openPositions },
            ]}
            ariaLabel="Portfolio book"
          />
          <Button variant="secondary" onClick={refreshNow} loading={refreshing}>
            <RefreshCw />
            Refresh
          </Button>
          <Link href="/scanner" className="btn btn-primary">
            <Radar />
            Find a pool
          </Link>
        </div>
      </div>

      {mode === "live" && !liveReady ? (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <ShieldAlert />
          <span>
            {data.liveReadiness.reason ??
              "Live execution is not fully enabled. You can inspect the book, but entries stay locked."}{" "}
            <Link href="/settings" style={{ color: "var(--accent)" }}>
              Open live controls
            </Link>
          </span>
        </div>
      ) : null}

      <div className="stats-strip">
        <Stat
          label="Equity"
          hero
          icon={<Wallet />}
          value={<AnimatedNumber value={summary.equity} format={(value) => fmtUsd(value)} />}
          sub={
            mode === "paper" ? (
              <span className={summary.dayPnl >= 0 ? "up" : "down"}>
                {fmtUsd(summary.dayPnl, { sign: true })} today · {fmtPct(summary.dayPnlPct, { sign: true })}
              </span>
            ) : (
              <span>Wallet + positions + fees</span>
            )
          }
        />
        <Stat
          label="Net P&L"
          icon={<TrendingUp />}
          value={
            <span className={summary.totalPnl >= 0 ? "up" : "down"}>
              {fmtUsd(summary.totalPnl, { sign: true })}
            </span>
          }
          sub={
            <>
              open{" "}
              <span className={summary.unrealizedPnl >= 0 ? "up" : "down"}>
                {fmtUsd(summary.unrealizedPnl, { sign: true })}
              </span>{" "}
              · realised{" "}
              <span className={summary.realizedPnl >= 0 ? "up" : "down"}>
                {fmtUsd(summary.realizedPnl, { sign: true })}
              </span>
            </>
          }
        />
        <Stat
          label="Fees earned"
          icon={<Coins />}
          value={<span className="up">{fmtUsd(summary.feeIncome)}</span>}
          sub={`${fmtUsd(summary.claimedFees)} claimed · ${fmtUsd(summary.unclaimedFees)} pending`}
        />
        <Stat
          label="Est. APR"
          icon={<Percent />}
          value={fmtPct(summary.estAprPct, { digits: 1 })}
          sub={`${fmtPct(summary.winRate, { digits: 0 })} win rate`}
        />
        {mode === "live" ? (
          <Stat
            label="Realized P&L"
            icon={<ActivityIcon />}
            value={
              <span className={summary.realizedPnl >= 0 ? "up" : "down"}>
                {fmtUsd(summary.realizedPnl, { sign: true })}
              </span>
            }
            sub={`${fmtUsd(summary.unrealizedPnl, { sign: true })} unrealized`}
          />
        ) : (
          <Stat
            label="Max drawdown"
            icon={<Gauge />}
            value={fmtPct(summary.maxDrawdownPct, { digits: 1 })}
            sub={`Hard limit ${fmtPct(risk.maxDrawdownPct, { digits: 0 })}`}
          />
        )}
        <Stat
          label="Exposure"
          icon={<Gauge />}
          value={fmtPct(summary.exposurePct, { digits: 0 })}
          sub={`${summary.openPositions} open · limit ${fmtPct(risk.maxTotalExposurePct, { digits: 0 })}`}
        />
      </div>

      <div className="dash-grid mt16">
        <div className="dash-stack">
          <Panel
            title={mode === "paper" ? "Paper equity curve" : "Live equity composition"}
            icon={<TrendingUp />}
            subtitle={
              mode === "paper"
                ? "Snapshots are written as the paper book marks and trades."
                : "Wallet value plus open positions and claimable fees."
            }
            action={
              mode === "paper" ? (
                <Segmented<Range>
                  value={range}
                  onChange={setRange}
                  size="sm"
                  options={[
                    { value: "24h", label: "24h" },
                    { value: "7d", label: "7d" },
                    { value: "30d", label: "30d" },
                    { value: "all", label: "All" },
                  ]}
                  ariaLabel="Chart range"
                />
              ) : (
                <Badge tone={liveReady ? "green" : "amber"} dot>
                  {liveReady ? "Executing" : "Read-only"}
                </Badge>
              )
            }
          >
            {mode === "paper" ? (
              <EquityChart points={chartPoints} initialCapital={data.paper.initialCapital} />
            ) : (
              <div>
                <div className="row between wrap" style={{ alignItems: "flex-end" }}>
                  <div>
                    <div className="pm-label">Total live equity</div>
                    <div className="mono" style={{ fontSize: 28, letterSpacing: "-0.03em", marginTop: 5 }}>
                      {fmtUsd(summary.equity)}
                    </div>
                  </div>
                  {data.wallet ? (
                    <div className="t-right">
                      <div className="pm-label">Wallet</div>
                      <div className="mono" style={{ fontSize: 14, marginTop: 5 }}>
                        {data.wallet.solBalance.toFixed(3)} SOL
                      </div>
                      <div className="dimtx">{data.wallet.tokens.length} token balances</div>
                    </div>
                  ) : null}
                </div>
                <div className="bar-stack mt24">
                  {composition.map((part) => (
                    <Bar
                      key={part.label}
                      label={part.label}
                      value={fmtUsd(part.value)}
                      percent={summary.equity > 0 ? (part.value / summary.equity) * 100 : 0}
                      color={part.color}
                    />
                  ))}
                </div>
                <p className="hint mt16">
                  Live equity is sampled from the execution wallet every 20 seconds. The paper curve
                  stays available as the strategy benchmark.
                </p>
              </div>
            )}
          </Panel>

          <Panel
            title="Open positions"
            icon={<Wallet />}
            subtitle={
              <>
                {mode === "live" ? "Live" : "Paper"} book · {openPositions.length} active · open P&amp;L{" "}
                <span className={openPnl >= 0 ? "up" : "down"}>
                  {fmtUsd(openPnl, { sign: true })}
                </span>
              </>
            }
            action={
              <Link href="/positions" className="btn btn-ghost btn-sm">
                Manage
                <ArrowRight />
              </Link>
            }
            flush
          >
            {openPositions.length ? (
              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Position</th>
                      <th className="hide-sm">Range</th>
                      <th className="hide-sm">Value</th>
                      <th className="hide-sm">Unclaimed</th>
                      <th>P&amp;L</th>
                      <th className="hide-sm">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openPositions.slice(0, 6).map((position) => (
                      <tr key={position.id}>
                        <td>
                          <Link href="/positions" className="cell-main">
                            <span className="token-pair">
                              <TokenIcon symbol={position.tokenXSymbol} />
                              <TokenIcon symbol={position.tokenYSymbol} index={1} />
                            </span>
                            <span className="truncate">
                              {position.tokenXSymbol}/{position.tokenYSymbol}
                            </span>
                          </Link>
                          <div className="cell-sub">
                            {position.strategy} · <ProtocolBadge protocol={position.protocol} />
                          </div>
                        </td>
                        <td className="hide-sm">
                          <Badge tone={position.inRange ? "green" : "amber"} dot>
                            {position.inRange ? "In range" : "Out"}
                          </Badge>
                        </td>
                        <td className="hide-sm mono">{fmtUsd(position.valueUsd)}</td>
                        <td className="hide-sm mono up">{fmtUsd(position.unclaimedFeesUsd)}</td>
                        <td>
                          <span className={`mono ${position.pnlUsd >= 0 ? "up" : "down"}`}>
                            {fmtUsd(position.pnlUsd, { sign: true })}
                          </span>
                          <div className="cell-sub">{fmtPct(position.pnlPct, { sign: true, digits: 1 })}</div>
                        </td>
                        <td className="hide-sm dimtx">{timeAgo(position.openedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={<Wallet />}
                title={`No open ${mode} positions`}
                message="Scan live pools, read the AI brief and open your first paper position in a click."
                action={
                  <Link href="/scanner" className="btn btn-primary btn-sm">
                    <Radar />
                    Browse pools
                  </Link>
                }
              />
            )}
          </Panel>

          <Panel
            title="Top opportunities"
            icon={<Radar />}
            subtitle="Ranked by net fee APR, consistency, safety and risk."
            action={
              <div className="row gap6">
                <Badge tone={data.market.stale ? "amber" : "green"} dot>
                  {data.market.stale ? "Cached" : "Live"}
                </Badge>
                <Link href="/scanner" className="btn btn-ghost btn-sm">
                  Scanner
                  <ArrowUpRight />
                </Link>
              </div>
            }
          >
            {topPools.length ? (
              <div className="mini-list">
                {topPools.map((analysis) => (
                  <button
                    key={`${analysis.pool.protocol}:${analysis.pool.address}`}
                    type="button"
                    className="mini-row"
                    onClick={() => openPool(analysis)}
                  >
                    <PoolPair pool={analysis.pool} />
                    <span className="mini-main">
                      <span className="mini-title">
                        {analysis.pool.tokenX.symbol}
                        <span className="dim">/</span>
                        {analysis.pool.tokenY.symbol}
                        <ProtocolBadge protocol={analysis.pool.protocol} />
                      </span>
                      <span className="mini-sub">
                        <span>{analysis.recommendedStrategy} range</span>
                        <span className="dim">·</span>
                        <span>{fmtCompact(analysis.pool.tvlUsd)} TVL</span>
                        <span className="dim">·</span>
                        <span>risk {Math.round(analysis.riskScore)}</span>
                      </span>
                    </span>
                    <span className="mini-end">
                      <span className="mono" style={{ fontSize: 13 }}>
                        {fmtPct(analysis.feeAprPct, { digits: 0 })}
                      </span>
                      <span className="dim" style={{ fontSize: 12.5, display: "block" }}>
                        fee APR
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<Radar />}
                title="Market feed warming up"
                message="Meteora data could not be reached on this refresh. Positions stay online; try the scanner in a moment."
                action={
                  <Link href="/scanner" className="btn btn-secondary btn-sm">
                    Open scanner
                  </Link>
                }
              />
            )}
          </Panel>
        </div>

        <div className="dash-side">
          <LiveStatusCard readiness={data.liveReadiness} wallet={data.wallet} />

          <Panel
            title="Auto-improve"
            icon={<Sparkles />}
            subtitle={`${mode === "live" ? "Live" : "Paper"} guard · ${improvement.sampleTrades} closed trade${
              improvement.sampleTrades === 1 ? "" : "s"
            } in ${improvement.windowDays}d`}
            action={
              <Badge
                tone={improvement.enabled ? improveHeatTone(improvement.heat) : "neutral"}
                dot={improvement.enabled}
                title={`${improvement.totalTrades} closed ${mode} trades on record`}
              >
                {improvement.enabled ? improveHeatLabel(improvement.heat) : "Off"}
              </Badge>
            }
          >
            {improvement.enabled ? (
              <>
                <div className="improve-metrics">
                  <div className="improve-metric">
                    <span>Sizing</span>
                    <strong>×{improvement.capitalScale.toFixed(2)}</strong>
                  </div>
                  <div className="improve-metric">
                    <span>Score floor</span>
                    <strong>{deltaPoints(improvement.entryScoreFloorDelta)}</strong>
                  </div>
                  <div className="improve-metric">
                    <span>Rotation edge</span>
                    <strong>{deltaPoints(improvement.rotationDeltaBonus)}</strong>
                  </div>
                  <div className="improve-metric">
                    <span>Rebalance grace</span>
                    <strong>+{improvement.rebalanceMinutesBonus} min</strong>
                  </div>
                </div>

                {improvement.pauseEntries ? (
                  <div className="notice danger mt12">
                    <ShieldAlert />
                    <span>
                      New entries paused · {improvement.pauseReason}
                      {improvement.pauseUntil
                        ? ` · rechecks in ${fmtCountdown(improvement.pauseUntil)}`
                        : ""}
                    </span>
                  </div>
                ) : null}

                {improvement.blockedPools.length ? (
                  <div className="improve-section">
                    <div className="improve-label">Cooling pools</div>
                    {improvement.blockedPools.slice(0, 3).map((pool) => (
                      <div className="improve-pool" key={pool.poolAddress}>
                        <div className="improve-pool-main">
                          <span className="truncate">{pool.poolName}</span>
                          <span className="improve-pool-sub">{pool.blockReason}</span>
                        </div>
                        <Badge tone="amber">
                          {pool.blockedUntil ? fmtCountdown(pool.blockedUntil) : "paused"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : null}

                {improvement.actions.length ? (
                  <div className="improve-section">
                    <div className="improve-label">Latest adaptations</div>
                    <ul className="improve-list">
                      {improvement.actions.slice(0, 4).map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="row between wrap mt12" style={{ gap: 8 }}>
                  <span className="dimtx">
                    {fmtPct(improvement.winRate, { digits: 0 })} win rate ·{" "}
                    <span className={improvement.netPnl >= 0 ? "up" : "down"}>
                      {fmtUsd(improvement.netPnl, { sign: true })}
                    </span>{" "}
                    window P&amp;L
                  </span>
                  <Link href="/bots" className="btn btn-ghost btn-sm">
                    Tune
                  </Link>
                </div>
              </>
            ) : (
              <p className="hint">
                Auto-improve is off for every running {mode} bot. Enable it in a bot&apos;s settings
                to adapt sizing, entry filters and re-entry bans from realised results.
              </p>
            )}
          </Panel>

          <Panel
            title="Risk posture"
            icon={<ShieldAlert />}
            subtitle="Account guardrails enforced on every entry."
            action={
              <Link href="/settings" className="btn btn-ghost btn-sm">
                Adjust
              </Link>
            }
          >
            <div className="bar-stack">
              <Bar
                label="Total exposure"
                value={`${fmtPct(summary.exposurePct, { digits: 0 })} / ${fmtPct(risk.maxTotalExposurePct, { digits: 0 })}`}
                percent={pctOf(summary.exposurePct, risk.maxTotalExposurePct)}
              />
              <Bar
                label="Open positions"
                value={`${summary.openPositions} / ${risk.maxOpenPositions}`}
                percent={pctOf(summary.openPositions, risk.maxOpenPositions)}
                color="var(--cyan)"
              />
              <Bar
                label="Drawdown (paper)"
                value={`${fmtPct(data.summary.maxDrawdownPct, { digits: 1 })} / ${fmtPct(risk.maxDrawdownPct, { digits: 0 })}`}
                percent={pctOf(data.summary.maxDrawdownPct, risk.maxDrawdownPct)}
                color="var(--amber)"
              />
            </div>
            <div className="row between mt16">
              <span className="dimtx">Kill switch</span>
              <Badge tone={data.liveReadiness.killSwitch ? "red" : "green"} dot>
                {data.liveReadiness.killSwitch ? "Engaged" : "Clear"}
              </Badge>
            </div>
            <div className="row between" style={{ marginTop: 6 }}>
              <span className="dimtx">Max per pool</span>
              <span className="mono" style={{ fontSize: 12.5 }}>
                {fmtPct(risk.maxCapitalPerPoolPct, { digits: 0 })} of equity
              </span>
            </div>
            <Button
              variant="outline"
              className="w-full mt16"
              onClick={() => setExitOpen(true)}
            >
              <ShieldAlert />
              Emergency exit
            </Button>
          </Panel>

          <Panel
            title="Autopilot fleet"
            icon={<Bot />}
            subtitle={`${runningBots} of ${fleet.length} strategies running`}
            action={
              <Link href="/bots" className="btn btn-ghost btn-sm">
                Open
              </Link>
            }
            flush
          >
            {fleet.length ? (
              <div className="mini-list">
                {fleet.slice(0, 4).map((bot) => {
                  const stats = data.botStats.find((item) => item.botId === bot.id);
                  return (
                    <Link key={bot.id} href="/bots" className="mini-row">
                      <span className={`dot ${bot.status === "running" ? "green" : bot.status === "error" ? "red" : ""}`} />
                      <div className="mini-main">
                        <div className="mini-title">
                          <span className="truncate">{bot.name}</span>
                          <Badge tone={bot.mode === "live" ? "amber" : "neutral"}>{bot.mode}</Badge>
                        </div>
                        <div className="mini-sub">
                          {RISK_PROFILE_COPY[bot.config.riskProfile].label} ·{" "}
                          {bot.lastRunAt ? `ran ${timeAgo(bot.lastRunAt)}` : "never ran"}
                          {stats ? ` · ${stats.openPositions} open` : ""}
                        </div>
                      </div>
                      <div className="mini-end">
                        <div className={`mono ${stats && stats.netPnl >= 0 ? "up" : stats ? "down" : "dim"}`} style={{ fontSize: 13 }}>
                          {stats ? fmtUsd(stats.netPnl, { sign: true }) : "—"}
                        </div>
                        <div className="dim" style={{ fontSize: 12.5 }}>
                          net P&amp;L
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<Bot />}
                title="No strategies yet"
                message="Create an autopilot strategy with capital, risk profile and pool filters."
                action={
                  <Link href="/bots" className="btn btn-primary btn-sm">
                    Create a bot
                  </Link>
                }
              />
            )}
          </Panel>

          <Panel
            title="Latest activity"
            icon={<ActivityIcon />}
            subtitle="Every decision is logged."
            action={
              <Link href="/activity" className="btn btn-ghost btn-sm">
                All
              </Link>
            }
            flush
          >
            {data.activity.length ? (
              <div className="timeline">
                {data.activity.slice(0, 6).map((item) => (
                  <div className="tl-item" key={item.id}>
                    <span className={`tl-dot ${item.level}`} />
                    <div className="tl-body">
                      <div className="tl-msg">{item.message}</div>
                      <div className="tl-meta">
                        <span className="cat">{item.category}</span>
                        <span>{timeAgo(item.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState icon={<ActivityIcon />} title="No activity yet" message="Entries, exits and risk events will appear here." />
            )}
          </Panel>
        </div>
      </div>

      <PoolDrawer
        selection={selected}
        onClose={() => setSelected(null)}
        liveReadiness={data.liveReadiness}
        paperCash={data.paper.cash}
        risk={risk}
        onOpened={() => {
          void refreshAll();
        }}
      />

      <EmergencyExitModal
        open={exitOpen}
        onClose={() => setExitOpen(false)}
        authWallet={data.user.authWallet}
        liveReadiness={data.liveReadiness}
        paperOpen={data.summary.openPositions}
        liveOpen={data.liveSummary.openPositions}
        onDone={() => {
          void refreshAll();
        }}
      />
    </div>
  );
}
