"use client";

import { useMemo, useState } from "react";
import {
  Coins,
  FlaskConical,
  Gauge,
  History,
  Percent,
  Play,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { BacktestRecord, PoolAnalysis, StrategyChoice } from "@/lib/types";
import { fmtCompact, fmtDate, fmtPct, fmtPrice, fmtUsd } from "@/lib/client/format";
import { useBacktests, useDebouncedValue, useScanner } from "@/lib/client/hooks";
import { apiPost, errorMessage } from "@/lib/client/api";
import { Badge, Button, EmptyState, Field, Panel, Segmented, Toggle } from "@/components/ui";
import { PageLoading } from "@/components/page-states";
import { EquityChart } from "@/components/charts";
import { PoolPair, ProtocolBadge, protocolLabel } from "@/components/market/pool-visuals";
import { useToast } from "@/components/toast";

interface ReplayForm {
  strategy: StrategyChoice;
  days: number;
  timeframe: "30m" | "1h" | "4h";
  capitalUsd: number;
  rangeWidthPct: number;
  feeCaptureRatio: number;
  rebalanceOutOfRange: boolean;
  rebalanceCooldownHours: number;
  stopLossPct: number;
  takeProfitPct: number;
  costBpsPerRebalance: number;
}

const DEFAULT_FORM: ReplayForm = {
  strategy: "auto",
  days: 14,
  timeframe: "1h",
  capitalUsd: 2_500,
  rangeWidthPct: 12,
  feeCaptureRatio: 0.65,
  rebalanceOutOfRange: true,
  rebalanceCooldownHours: 6,
  stopLossPct: 15,
  takeProfitPct: 50,
  costBpsPerRebalance: 30,
};

function poolKey(analysis: PoolAnalysis): string {
  return `${analysis.pool.protocol}:${analysis.pool.address}`;
}

function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "up" | "down";
  sub?: string;
}) {
  return (
    <div className="panel" style={{ background: "var(--surface-2)" }}>
      <div className="panel-body tight" style={{ padding: "11px 12px" }}>
        <div className="pm-label">{label}</div>
        <div className={`pm-value ${tone ?? ""}`} style={{ fontSize: 15, marginTop: 5 }}>
          {value}
        </div>
        {sub ? <div className="hint" style={{ marginTop: 3 }}>{sub}</div> : null}
      </div>
    </div>
  );
}

export default function BacktestPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const {
    data: scan,
    error: scanError,
    isLoading: scanning,
    mutate: rescan,
  } = useScanner({ search: debouncedSearch || undefined, limit: 24 });
  const {
    data: historyData,
    error: historyError,
    isLoading: historyLoading,
    mutate: mutateHistory,
  } = useBacktests();
  const [selectedKey, setSelectedKey] = useState("");
  const [form, setForm] = useState<ReplayForm>(DEFAULT_FORM);
  const [running, setRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runRecord, setRunRecord] = useState<BacktestRecord | null>(null);

  const pools = scan?.pools ?? [];
  const selected = useMemo(
    () => pools.find((analysis) => poolKey(analysis) === selectedKey) ?? pools[0] ?? null,
    [pools, selectedKey],
  );
  const history = historyData?.backtests ?? [];
  const active =
    runRecord ?? (activeId ? history.find((record) => record.id === activeId) : undefined) ?? history[0] ?? null;

  function set<K extends keyof ReplayForm>(key: K, value: ReplayForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function choosePool(key: string) {
    setSelectedKey(key);
    const analysis = pools.find((pool) => poolKey(pool) === key);
    if (analysis) {
      setForm((current) => ({
        ...current,
        rangeWidthPct: Number(analysis.range.widthPct.toFixed(1)),
      }));
    }
  }

  function validate(): string | null {
    if (!selected) return "Choose a pool to replay.";
    if (!Number.isFinite(form.days) || form.days < 3 || form.days > 60) return "Days must be 3–60.";
    if (!Number.isFinite(form.capitalUsd) || form.capitalUsd < 100) return "Capital must be at least $100.";
    if (form.rangeWidthPct < 0.4 || form.rangeWidthPct > 90) return "Range width must be 0.4–90%.";
    if (form.feeCaptureRatio < 0.05 || form.feeCaptureRatio > 1) return "Fee capture must be 5–100%.";
    if (form.rebalanceCooldownHours < 0.5 || form.rebalanceCooldownHours > 168) {
      return "Cooldown must be 0.5–168 hours.";
    }
    if (form.stopLossPct < 0.5 || form.stopLossPct > 80) return "Stop loss must be 0.5–80%.";
    if (form.takeProfitPct < 1 || form.takeProfitPct > 500) return "Take profit must be 1–500%.";
    if (form.costBpsPerRebalance < 0 || form.costBpsPerRebalance > 500) {
      return "Cost per rebalance must be 0–500 bps.";
    }
    return null;
  }

  async function runReplay() {
    const message = validate();
    if (message) {
      setFormError(message);
      return;
    }
    if (!selected) return;
    setRunning(true);
    setFormError(null);
    try {
      const response = await apiPost<{ backtest: BacktestRecord }>("/api/backtest", {
        protocol: selected.pool.protocol,
        poolAddress: selected.pool.address,
        poolName: `${selected.pool.tokenX.symbol}/${selected.pool.tokenY.symbol}`,
        ...form,
      });
      setRunRecord(response.backtest);
      setActiveId(response.backtest.id);
      toast.success(
        "Replay complete",
        `${response.backtest.poolName} · ${fmtPct(response.backtest.result.totalReturnPct, { sign: true })} over ${response.backtest.config.days}d`,
      );
      await mutateHistory();
    } catch (caught) {
      setFormError(errorMessage(caught));
      toast.fromError("Backtest failed", caught);
    } finally {
      setRunning(false);
    }
  }

  async function refreshAll() {
    setRefreshing(true);
    try {
      await Promise.all([rescan(), mutateHistory()]);
      toast.success("Lab refreshed");
    } catch {
      toast.error("Could not refresh the lab");
    } finally {
      setRefreshing(false);
    }
  }

  if (historyLoading && !historyData && !scan && scanning) {
    return <PageLoading label="Loading the backtest lab" />;
  }

  const result = active?.result;
  const trades = result?.trades ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div className="lede">
          <div className="row gap8 wrap">
            <span className="eyebrow">Research lab</span>
            <Badge tone="cyan" dot>
              Historical replay
            </Badge>
            <span className="dimtx">Real candles · fee capture model · execution costs</span>
          </div>
          <h1 className="h1 mt8">Backtest lab</h1>
          <p className="sub mt8">
            Replay a range strategy against real Meteora price and fee data before committing paper
            or live capital. Costs, rebalances and time out of range are modelled explicitly.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={refreshAll} loading={refreshing}>
            <RefreshCw />
            Refresh data
          </Button>
        </div>
      </div>

      <div className="dash-grid">
        <div className="dash-stack">
          {result && active ? (
            <>
              <Panel
                title={`${active.poolName} · ${active.config.days}d ${active.config.timeframe}`}
                icon={<FlaskConical />}
                subtitle={`${protocolLabel(active.protocol)} · ${active.config.strategy} strategy · ${fmtUsd(active.config.capitalUsd)} capital · ran ${fmtDate(active.createdAt)}`}
                action={<Badge tone={result.totalReturnPct >= 0 ? "green" : "red"} dot>{fmtPct(result.totalReturnPct, { sign: true })}</Badge>}
              >
                <div className="grid g4 as-2">
                  <Metric
                    label="Total return"
                    value={fmtPct(result.totalReturnPct, { sign: true })}
                    tone={result.totalReturnPct >= 0 ? "up" : "down"}
                    sub={`${fmtUsd(result.finalEquity)} final equity`}
                  />
                  <Metric
                    label="Annualised"
                    value={fmtPct(result.annualizedPct, { sign: true })}
                    tone={result.annualizedPct >= 0 ? "up" : "down"}
                    sub="Compounded run-rate"
                  />
                  <Metric
                    label="Max drawdown"
                    value={fmtPct(result.maxDrawdownPct, { digits: 1 })}
                    tone={result.maxDrawdownPct > 0 ? "down" : undefined}
                    sub={`Limit ${fmtPct(form.stopLossPct, { digits: 0 })} stop`}
                  />
                  <Metric
                    label="Time in range"
                    value={fmtPct(result.timeInRangePct, { digits: 0 })}
                    sub={`${result.rebalances} rebalances`}
                  />
                  <Metric
                    label="Fees captured"
                    value={fmtUsd(result.feesUsd)}
                    tone="up"
                    sub={`${fmtUsd(result.costsUsd)} costs`}
                  />
                  <Metric
                    label="Win rate"
                    value={fmtPct(result.winRate, { digits: 0 })}
                    sub={`${trades.filter((trade) => trade.closedAt !== null).length} closed of ${trades.length} trades`}
                  />
                  <Metric
                    label="Sharpe"
                    value={result.sharpe.toFixed(2)}
                    sub="Per-candle returns"
                  />
                  <Metric
                    label="Candles"
                    value={result.candles}
                    sub={`${Math.round(active.config.feeCaptureRatio * 100)}% fee capture`}
                  />
                </div>
                <div className="mt16">
                  <EquityChart points={result.equityCurve} initialCapital={result.initialCapital} height={240} />
                </div>
                <div className="hint mt12">
                  {result.assumptions.join(" · ")}
                </div>
              </Panel>

              <Panel
                title="Trade ledger"
                icon={<History />}
                subtitle={
                  trades.length
                    ? `Latest ${Math.min(30, trades.length)} of ${trades.length} simulated trades`
                    : "No trades were triggered in this replay."
                }
                flush
              >
                {trades.length ? (
                  <div className="table-wrap" style={{ maxHeight: 360, overflowY: "auto" }}>
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>Opened</th>
                          <th>Entry → exit</th>
                          <th className="hide-sm">Range</th>
                          <th>Fees</th>
                          <th>P&amp;L</th>
                          <th className="hide-sm">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.slice(-30).reverse().map((trade, index) => (
                          <tr key={`${trade.openedAt}-${index}`}>
                            <td className="dimtx">{fmtDate(trade.openedAt)}</td>
                            <td>
                              <span className="mono" style={{ fontSize: 13 }}>
                                {fmtPrice(trade.entryPrice)} → {trade.exitPrice ? fmtPrice(trade.exitPrice) : "open"}
                              </span>
                              <div className="cell-sub">{fmtDate(trade.closedAt)}</div>
                            </td>
                            <td className="hide-sm mono">
                              {fmtPrice(trade.lowerPrice)} – {fmtPrice(trade.upperPrice)}
                            </td>
                            <td className="mono up">{fmtUsd(trade.feesUsd)}</td>
                            <td>
                              <span className={`mono ${trade.pnlUsd >= 0 ? "up" : "down"}`}>
                                {fmtUsd(trade.pnlUsd, { sign: true })}
                              </span>
                              <div className="cell-sub">{fmtPct(trade.pnlPct, { sign: true, digits: 1 })}</div>
                            </td>
                            <td className="hide-sm dimtx">{trade.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<FlaskConical />}
                    title="No trades in this window"
                    message="Widen the range, lower the fee floor or extend the replay window."
                  />
                )}
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState
                icon={<FlaskConical />}
                title="Run your first replay"
                message="Pick a pool, choose a window and capital, then replay the range strategy against real candles. Results include fees, costs, drawdown and every rebalance."
                action={
                  <span className="dimtx">
                    <Radar size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
                    {pools.length ? `${pools.length} pools ready to test` : "Waiting for the market feed"}
                  </span>
                }
              />
            </Panel>
          )}
        </div>

        <div className={`dash-side ${result ? "" : "side-first"}`}>
          <Panel
            title="Configure a replay"
            icon={<Play />}
            subtitle="Modelled on the same risk engine as the autopilot."
          >
            <div className="col gap12">
              <Field
                label="Pool"
                hint={
                  scanError
                    ? "Market feed unavailable. Retry the refresh once the indexer responds."
                    : scanning
                      ? "Scanning Meteora pools…"
                      : `${pools.length} pools · search by token or address`
                }
              >
                <div className="search-box" style={{ marginBottom: 7 }}>
                  <Search />
                  <input
                    className="input"
                    placeholder="Find a pool"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    aria-label="Search pools for backtest"
                  />
                </div>
                <select
                  className="select"
                  value={selected ? poolKey(selected) : ""}
                  onChange={(event) => choosePool(event.target.value)}
                  disabled={!pools.length}
                  aria-label="Pool to backtest"
                >
                  {!pools.length ? <option value="">No pools available</option> : null}
                  {pools.map((analysis) => (
                    <option key={poolKey(analysis)} value={poolKey(analysis)}>
                      {analysis.pool.tokenX.symbol}/{analysis.pool.tokenY.symbol} ·{" "}
                      {protocolLabel(analysis.pool.protocol)} · {fmtCompact(analysis.pool.tvlUsd)} TVL
                    </option>
                  ))}
                </select>
              </Field>

              {selected ? (
                <div className="range-viz">
                  <div className="row between wrap" style={{ gap: 8 }}>
                    <div className="row gap8">
                      <PoolPair pool={selected.pool} />
                      <div>
                        <div className="pool-name">
                          {selected.pool.tokenX.symbol}/{selected.pool.tokenY.symbol}
                        </div>
                        <div className="pool-meta">
                          <ProtocolBadge protocol={selected.pool.protocol} />
                          <span className="sepd" />
                          <span>{selected.recommendedStrategy} recommended</span>
                        </div>
                      </div>
                    </div>
                    <div className="t-right">
                      <div className="mono" style={{ fontSize: 14 }}>{fmtPct(selected.feeAprPct, { digits: 0 })}</div>
                      <div className="dim" style={{ fontSize: 12.5 }}>fee APR</div>
                    </div>
                  </div>
                  <div className="grid g4 mt12" style={{ gap: 8 }}>
                    <div>
                      <div className="pm-label">TVL</div>
                      <div className="pm-value">{fmtCompact(selected.pool.tvlUsd)}</div>
                    </div>
                    <div>
                      <div className="pm-label">24h fees</div>
                      <div className="pm-value">{fmtCompact(selected.pool.fees24hUsd)}</div>
                    </div>
                    <div>
                      <div className="pm-label">AI score</div>
                      <div className="pm-value">{Math.round(selected.score)}</div>
                    </div>
                    <div>
                      <div className="pm-label">Risk</div>
                      <div className="pm-value">{Math.round(selected.riskScore)}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="form-grid">
                <Field label="Strategy">
                  <select
                    className="select"
                    value={form.strategy}
                    onChange={(event) => set("strategy", event.target.value as StrategyChoice)}
                  >
                    <option value="auto">Auto (recommended)</option>
                    <option value="spot">Spot</option>
                    <option value="curve">Curve</option>
                    <option value="bidask">BidAsk</option>
                  </select>
                </Field>
                <Field label="Window">
                  <select
                    className="select"
                    value={form.days}
                    onChange={(event) => set("days", Number(event.target.value))}
                  >
                    {[3, 7, 14, 30, 60].map((days) => (
                      <option key={days} value={days}>
                        {days} days
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Timeframe">
                  <Segmented<"30m" | "1h" | "4h">
                    value={form.timeframe}
                    onChange={(value) => set("timeframe", value)}
                    size="sm"
                    options={[
                      { value: "30m", label: "30m" },
                      { value: "1h", label: "1h" },
                      { value: "4h", label: "4h" },
                    ]}
                    ariaLabel="Backtest timeframe"
                  />
                </Field>
                <Field label="Capital">
                  <div className="input-wrap">
                    <span className="input-suffix" style={{ left: 11, right: "auto" }}>$</span>
                    <input
                      className="input"
                      style={{ paddingLeft: 24 }}
                      type="number"
                      min={100}
                      step={100}
                      value={form.capitalUsd}
                      onChange={(event) => set("capitalUsd", Number(event.target.value))}
                    />
                  </div>
                </Field>
                <Field label="Range width" hint={selected ? `AI range ${selected.range.widthPct.toFixed(1)}%` : undefined}>
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      type="number"
                      min={0.4}
                      max={90}
                      step={0.5}
                      value={form.rangeWidthPct}
                      onChange={(event) => set("rangeWidthPct", Number(event.target.value))}
                    />
                    <span className="input-suffix">%</span>
                  </div>
                </Field>
                <Field label="Fee capture">
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      type="number"
                      min={5}
                      max={100}
                      step={5}
                      value={Math.round(form.feeCaptureRatio * 100)}
                      onChange={(event) =>
                        set("feeCaptureRatio", Math.min(1, Math.max(0.05, Number(event.target.value) / 100)))
                      }
                    />
                    <span className="input-suffix">%</span>
                  </div>
                </Field>
                <Field label="Stop loss">
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      type="number"
                      min={0.5}
                      max={80}
                      step={1}
                      value={form.stopLossPct}
                      onChange={(event) => set("stopLossPct", Number(event.target.value))}
                    />
                    <span className="input-suffix">%</span>
                  </div>
                </Field>
                <Field label="Take profit">
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      type="number"
                      min={1}
                      max={500}
                      step={5}
                      value={form.takeProfitPct}
                      onChange={(event) => set("takeProfitPct", Number(event.target.value))}
                    />
                    <span className="input-suffix">%</span>
                  </div>
                </Field>
                <Field label="Rebalance cooldown">
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      type="number"
                      min={0.5}
                      max={168}
                      step={0.5}
                      value={form.rebalanceCooldownHours}
                      onChange={(event) => set("rebalanceCooldownHours", Number(event.target.value))}
                    />
                    <span className="input-suffix">hrs</span>
                  </div>
                </Field>
                <Field label="Cost per rebalance">
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      type="number"
                      min={0}
                      max={500}
                      step={5}
                      value={form.costBpsPerRebalance}
                      onChange={(event) => set("costBpsPerRebalance", Number(event.target.value))}
                    />
                    <span className="input-suffix">bps</span>
                  </div>
                </Field>
              </div>

              <Toggle
                checked={form.rebalanceOutOfRange}
                onChange={(value) => set("rebalanceOutOfRange", value)}
                label="Rebalance when out of range"
                sub="Re-centre the range after the cooldown, paying modelled costs each move."
              />

              {formError ? (
                <div className="notice danger">
                  <TriangleAlert />
                  <span>{formError}</span>
                </div>
              ) : null}

              {scanError ? (
                <div className="notice warn">
                  <ShieldAlert />
                  <span>{scanError instanceof Error ? scanError.message : "The market feed is unavailable."}</span>
                </div>
              ) : null}

              <Button variant="primary" className="w-full" onClick={runReplay} loading={running} disabled={!selected}>
                <Play />
                Run replay
              </Button>
              <p className="hint">
                Replays use historical candles and a configurable share of published fees. Past
                behaviour does not guarantee future returns.
              </p>
            </div>
          </Panel>

          <Panel
            title="Replay history"
            icon={<History />}
            subtitle={`${history.length} saved replays`}
            action={historyError ? <Badge tone="amber">offline</Badge> : null}
            flush
          >
            {history.length ? (
              <div className="mini-list">
                {history.slice(0, 8).map((record) => {
                  const isActive = active?.id === record.id;
                  const positive = record.result.totalReturnPct >= 0;
                  return (
                    <button
                      type="button"
                      key={record.id}
                      className="mini-row"
                      style={{
                        width: "100%",
                        textAlign: "left",
                        background: isActive ? "var(--accent-softer)" : "transparent",
                        border: 0,
                      }}
                      onClick={() => {
                        setActiveId(record.id);
                        setRunRecord(null);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      <span
                        className={`dot ${positive ? "green" : "red"}`}
                        style={{ marginTop: 0 }}
                      />
                      <div className="mini-main">
                        <div className="mini-title">
                          <span className="truncate">{record.poolName}</span>
                          <Badge tone="neutral">{protocolLabel(record.protocol)}</Badge>
                        </div>
                        <div className="mini-sub">
                          {record.config.days}d · {record.config.timeframe} ·{" "}
                          {fmtUsd(record.config.capitalUsd)} · {fmtDate(record.createdAt)}
                        </div>
                      </div>
                      <div className="mini-end">
                        <div className={`mono ${positive ? "up" : "down"}`} style={{ fontSize: 13 }}>
                          {fmtPct(record.result.totalReturnPct, { sign: true })}
                        </div>
                        <div className="dim" style={{ fontSize: 12.5 }}>
                          {fmtPct(record.result.maxDrawdownPct, { digits: 1 })} dd
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<History />}
                title="No saved replays"
                message="Completed replays are stored here so you can compare configurations."
              />
            )}
          </Panel>

          <Panel
            title="Model assumptions"
            icon={<Percent />}
            subtitle="What the simulator does and does not know."
          >
            <div className="checklist">
              <div className="check-item done">
                <span className="ci-ic">
                  <Coins />
                </span>
                <div className="ci-text">
                  <div className="ci-title">Fee capture</div>
                  <div className="ci-sub">A configurable share of published pool fees, applied while price sits inside the range.</div>
                </div>
              </div>
              <div className="check-item done">
                <span className="ci-ic">
                  <Gauge />
                </span>
                <div className="ci-text">
                  <div className="ci-title">Rebalance costs</div>
                  <div className="ci-sub">Slippage, swap and network costs are charged on every rebalance in basis points.</div>
                </div>
              </div>
              <div className="check-item">
                <span className="ci-ic">
                  <ShieldAlert />
                </span>
                <div className="ci-text">
                  <div className="ci-title">Not a price predictor</div>
                  <div className="ci-sub">Replays replay the past. Live risk limits and pool safety filters still apply at execution.</div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
