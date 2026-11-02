"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  CircleCheck,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { LiveReadiness, RiskSettings, StrategyChoice, TradingMode } from "@/lib/types";
import { fmtCompact, fmtPct, fmtPrice, timeAgo } from "@/lib/client/format";
import { apiPost, errorMessage } from "@/lib/client/api";
import { usePoolDetail, useRefreshAll } from "@/lib/client/hooks";
import { analyzeCandles, rsiLabel, trendLabel, type TechnicalRead } from "@/lib/analytics/technical";
import { Badge, Button, Drawer, Field, ScoreRing, Segmented, Skeleton } from "../ui";
import { useToast } from "../toast";
import { CandleChart } from "./candle-chart";
import {
  PoolPair,
  ProtocolBadge,
  RiskBadge,
  StrategyBadge,
  protocolLabel,
} from "./pool-visuals";
import { PriceRangeBar } from "./price-range";

type Protocol = "dlmm" | "damm-v2";

export interface PoolSelection {
  protocol: Protocol;
  address: string;
}

function MetricBox({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "up" | "down" }) {
  return (
    <div className="panel" style={{ background: "var(--surface-2)" }}>
      <div className="panel-body tight" style={{ padding: "10px 11px" }}>
        <div className="pm-label">{label}</div>
        <div className={`pm-value ${tone ?? ""}`} style={{ fontSize: 14, marginTop: 4 }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function TechMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone?: "up" | "down" | "warn" | "accent";
}) {
  return (
    <div className="tech-cell">
      <div className="tech-label">{label}</div>
      <div className={`tech-value ${tone ?? ""}`}>{value}</div>
      <div className="tech-sub" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function buildRangeInsight(read: TechnicalRead, rangeFitPct: number | null): string {
  if (read.candles < 8) return "";
  if (rangeFitPct !== null && rangeFitPct < 35) {
    return "Consider widening the band or waiting for consolidation to avoid repeated rebalances.";
  }
  if (read.rsi14 !== null && read.rsi14 >= 70) {
    return "RSI is overbought; short-term pullbacks make a slightly wider band safer.";
  }
  if (read.rsi14 !== null && read.rsi14 <= 30) {
    return "RSI is oversold; a snap-back could leave a tight band quickly.";
  }
  if (read.trend === "down") {
    return "The downtrend favours a lower, wider band to avoid repeated rebalances.";
  }
  if (read.trend === "up") {
    return "The uptrend supports a band tilted above spot to keep fees flowing.";
  }
  if (rangeFitPct !== null && rangeFitPct >= 70) {
    return "The band captures most closes, which supports steady fee accrual.";
  }
  if (read.volumeTrendPct !== null && read.volumeTrendPct > 25) {
    return "Volume is accelerating, which raises fee potential.";
  }
  return "Conditions look balanced; watch RSI and the nearest levels for the next move.";
}

function buildReadSummary(read: TechnicalRead, rangeFitPct: number | null): string {
  if (read.candles < 8 || read.lastClose === null) {
    return "Not enough price history in this window for a reliable technical read. Switch to a longer period or candle size.";
  }
  const parts = [
    `Price is trending ${
      read.trend === "up" ? "up" : read.trend === "down" ? "down" : "sideways"
    }${
      read.trendPct === null
        ? ""
        : ` (${fmtPct(read.trendPct, { sign: true, digits: 1 })} fitted over ${read.trendWindow} candles)`
    }`,
  ];
  if (read.rsi14 !== null) parts.push(`RSI ${read.rsi14.toFixed(0)} is ${rsiLabel(read.rsi14).toLowerCase()}`);
  if (read.volumeTrendPct !== null) {
    parts.push(`volume runs ${fmtPct(read.volumeTrendPct, { sign: true, digits: 0 })} vs the prior window`);
  }
  const levels: string[] = [];
  if (read.support !== null && read.supportDistancePct !== null) {
    levels.push(`support ${fmtPct(read.supportDistancePct, { digits: 1 })} below`);
  }
  if (read.resistance !== null && read.resistanceDistancePct !== null) {
    levels.push(`resistance ${fmtPct(read.resistanceDistancePct, { digits: 1 })} above`);
  }
  const levelLine = levels.length ? ` Nearest ${levels.join(" and ")}.` : "";
  const bandLine =
    rangeFitPct === null
      ? ""
      : ` ${fmtPct(rangeFitPct, { digits: 0 })} of candles closed inside the recommended band.`;
  const insight = buildRangeInsight(read, rangeFitPct);
  return `${parts.join(", ")}.${levelLine}${bandLine}${insight ? ` ${insight}` : ""}`
    .replace(/\s+/g, " ")
    .trim();
}

export function PoolDrawer({
  selection,
  onClose,
  liveReadiness,
  paperCash,
  risk,
  onOpened,
}: {
  selection: PoolSelection | null;
  onClose: () => void;
  liveReadiness?: LiveReadiness | null;
  paperCash?: number;
  risk?: RiskSettings;
  onOpened?: () => void;
}) {
  const toast = useToast();
  const refresh = useRefreshAll();
  const [days, setDays] = useState<7 | 1 | 30>(7);
  const [timeframe, setTimeframe] = useState<"30m" | "1h" | "4h">("1h");
  const [mode, setMode] = useState<TradingMode>("paper");
  const [capital, setCapital] = useState("2500");
  const [strategy, setStrategy] = useState<StrategyChoice>("auto");
  const [widthMode, setWidthMode] = useState<"auto" | "custom">("auto");
  const [width, setWidth] = useState("12");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = usePoolDetail(
    selection?.protocol ?? null,
    selection?.address ?? null,
    days,
    timeframe,
  );

  useEffect(() => {
    setMode("paper");
    setStrategy("auto");
    setWidthMode("auto");
    setConfirmed(false);
    setFormError(null);
    setCapital("2500");
  }, [selection?.address]);

  useEffect(() => {
    if (data?.analysis.range.widthPct) {
      setWidth(data.analysis.range.widthPct.toFixed(1));
    }
  }, [data?.analysis.range.widthPct]);

  const analysis = data?.analysis;
  const pool = analysis?.pool;
  const read = useMemo(() => analyzeCandles(data?.candles ?? []), [data?.candles]);
  const rangeFitPct = useMemo(() => {
    const candles = data?.candles ?? [];
    const range = data?.analysis.range;
    if (!candles.length || !range) return null;
    const inside = candles.filter(
      (candle) => candle.close >= range.lowerPrice && candle.close <= range.upperPrice,
    ).length;
    return (inside / candles.length) * 100;
  }, [data?.candles, data?.analysis.range]);
  const readSummary = useMemo(() => buildReadSummary(read, rangeFitPct), [read, rangeFitPct]);
  const liveBlockedReason = useMemo(() => {
    if (!analysis) return "Waiting for pool data.";
    if (analysis.pool.protocol !== "dlmm") {
      return "Live execution currently supports Meteora DLMM. DAMM v2 is available in paper trading.";
    }
    if (!liveReadiness) return "Checking live readiness.";
    if (!liveReadiness.canTrade) return liveReadiness.reason ?? "Live trading is not ready.";
    return null;
  }, [analysis, liveReadiness]);

  const capitalNumber = Number(capital);
  const capitalValid = Number.isFinite(capitalNumber) && capitalNumber >= 10 && capitalNumber <= 1_000_000;
  const widthNumber = Number(width);
  const widthValid = widthMode === "auto" || (Number.isFinite(widthNumber) && widthNumber >= 0.4 && widthNumber <= 90);
  const canSubmit =
    Boolean(analysis) &&
    capitalValid &&
    widthValid &&
    !submitting &&
    (mode === "paper" || (!liveBlockedReason && confirmed));

  async function openPosition() {
    if (!selection || !analysis) return;
    setFormError(null);
    if (!capitalValid) {
      setFormError("Enter a capital amount between $10 and $1,000,000.");
      return;
    }
    if (widthMode === "custom" && !widthValid) {
      setFormError("Range width must be between 0.4% and 90%.");
      return;
    }
    if (mode === "live" && liveBlockedReason) {
      setFormError(liveBlockedReason);
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/positions/open", {
        protocol: selection.protocol,
        address: selection.address,
        mode,
        capitalUsd: capitalNumber,
        strategy,
        ...(widthMode === "custom" ? { widthPct: widthNumber } : {}),
      });
      toast.success(
        mode === "live" ? "Live position submitted" : "Paper position opened",
        `${analysis.pool.tokenX.symbol}/${analysis.pool.tokenY.symbol} · ${fmtCompact(capitalNumber)}`,
      );
      await refresh();
      onOpened?.();
      onClose();
    } catch (caught) {
      setFormError(errorMessage(caught));
      toast.fromError("Could not open the position", caught);
    } finally {
      setSubmitting(false);
    }
  }

  const title = pool ? `${pool.tokenX.symbol} / ${pool.tokenY.symbol}` : "Pool analysis";
  const subtitle = pool
    ? `${protocolLabel(pool.protocol)} · ${pool.binStep} bp bins · ${selection?.address.slice(0, 6)}…${selection?.address.slice(-6)}`
    : selection
      ? `${selection.protocol} · ${selection.address.slice(0, 6)}…`
      : "";

  return (
    <Drawer
      open={Boolean(selection)}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      size="lg"
      footer={
        <>
          <span className="dimtx">
            {analysis ? `Analysed ${timeAgo(analysis.updatedAt)} · data cached` : "Official Meteora data"}
          </span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {isLoading && !data ? (
        <div className="col gap16">
          <div className="row between">
            <div className="row gap12">
              <Skeleton width={54} height={40} radius={10} />
              <div className="col gap6">
                <Skeleton width={180} height={18} />
                <Skeleton width={120} height={11} />
              </div>
            </div>
            <Skeleton width={48} height={48} radius={24} />
          </div>
          <div className="grid g4">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} height={62} radius={12} />
            ))}
          </div>
          <Skeleton height={220} radius={14} />
          <Skeleton height={120} radius={14} />
        </div>
      ) : error || !analysis || !pool ? (
        <div className="col gap12">
          <div className="notice danger">
            <TriangleAlert />
            <span>
              Pool data could not be loaded. {error instanceof Error ? error.message : "Try again in a moment."}
            </span>
          </div>
          <Button variant="secondary" onClick={() => mutate()}>
            <RefreshCw />
            Retry
          </Button>
        </div>
      ) : (
        <div className="col gap16">
          <div className="row between wrap">
            <div className="row gap12">
              <PoolPair pool={pool} size="lg" />
              <div>
                <div className="row gap8 wrap">
                  <span className="h2">{pool.tokenX.symbol}/{pool.tokenY.symbol}</span>
                  <ProtocolBadge protocol={pool.protocol} />
                </div>
                <div className="pool-meta mt4" style={{ marginTop: 5 }}>
                  <span className="mono">{fmtPrice(pool.currentPrice)}</span>
                  <span className="sepd" />
                  <span>{pool.binStep} bp bin step</span>
                  <span className="sepd" />
                  <span>{pool.tags.slice(0, 2).join(" · ") || "Standard"}</span>
                </div>
              </div>
            </div>
            <div className="score" style={{ marginLeft: "auto" }}>
              <div style={{ textAlign: "right" }}>
                <div className="dim" style={{ fontSize: 12.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Opportunity
                </div>
                <div className="mono" style={{ fontSize: 13, marginTop: 2 }}>
                  score {Math.round(analysis.score)}
                </div>
              </div>
              <ScoreRing value={analysis.score} size={48} />
            </div>
          </div>

          <div className="grid g4 as-2">
            <MetricBox
              label="Fee APR"
              value={fmtPct(analysis.feeAprPct, { digits: 1 })}
              tone="up"
            />
            <MetricBox label="Net APR est." value={fmtPct(analysis.netAprPct, { digits: 1 })} />
            <MetricBox label="24h fees" value={fmtCompact(pool.fees24hUsd)} />
            <MetricBox label="TVL" value={fmtCompact(pool.tvlUsd)} />
            <MetricBox label="24h volume" value={fmtCompact(pool.volume24hUsd)} />
            <MetricBox label="Volatility" value={fmtPct(analysis.volatilityPct, { digits: 1 })} />
            <MetricBox
              label="Risk"
              value={<RiskBadge score={analysis.riskScore} />}
            />
            <MetricBox
              label="Pool age"
              value={
                analysis.signals.ageHours >= 48
                  ? `${Math.round(analysis.signals.ageHours / 24)}d`
                  : `${Math.round(analysis.signals.ageHours)}h`
              }
            />
          </div>

          <div className="panel" style={{ background: "var(--surface-2)" }}>
            <div className="panel-head chart-head">
              <div>
                <div className="panel-title">Candlestick &amp; recommended range</div>
                <div className="panel-sub">
                  SMA/EMA overlays, swing levels and the engine&apos;s band.
                </div>
              </div>
              <div className="chart-controls">
                <Segmented
                  size="sm"
                  value={String(days)}
                  onChange={(value) => setDays(Number(value) as 1 | 7 | 30)}
                  options={[
                    { value: "1", label: "1D" },
                    { value: "7", label: "7D" },
                    { value: "30", label: "30D" },
                  ]}
                  ariaLabel="Chart period"
                />
                <Segmented
                  size="sm"
                  value={timeframe}
                  onChange={(value) => setTimeframe(value as "30m" | "1h" | "4h")}
                  options={[
                    { value: "30m", label: "30m" },
                    { value: "1h", label: "1h" },
                    { value: "4h", label: "4h" },
                  ]}
                  ariaLabel="Candle size"
                />
              </div>
            </div>
            <div className="panel-body tight">
              <CandleChart
                candles={data?.candles ?? []}
                lowerPrice={analysis.range.lowerPrice}
                upperPrice={analysis.range.upperPrice}
                height={300}
              />
            </div>
          </div>

          <div className="panel" style={{ background: "var(--surface-2)" }}>
            <div className="panel-head tech-head">
              <div>
                <div className="panel-title">
                  <Activity />
                  Technical read
                </div>
                <div className="panel-sub">
                  {read.candles} candles · {timeframe} · {days}D window
                </div>
              </div>
              <div className="row gap6 wrap">
                <Badge tone={read.trend === "up" ? "green" : read.trend === "down" ? "red" : "neutral"}>
                  {trendLabel(read.trend)}
                </Badge>
                <Badge
                  tone={
                    read.rsi14 !== null && (read.rsi14 >= 70 || read.rsi14 <= 30) ? "amber" : "neutral"
                  }
                >
                  RSI {rsiLabel(read.rsi14)}
                </Badge>
              </div>
            </div>
            <div className="panel-body">
              <div className="tech-grid">
                <TechMetric
                  label="Trend"
                  tone={read.trend === "up" ? "up" : read.trend === "down" ? "down" : undefined}
                  value={
                    <>
                      <span
                        className="tech-dot"
                        style={{
                          background:
                            read.trend === "up"
                              ? "var(--green)"
                              : read.trend === "down"
                                ? "var(--red)"
                                : "var(--text-3)",
                        }}
                      />
                      {trendLabel(read.trend)}
                    </>
                  }
                  sub={
                    read.trendPct === null
                      ? "Not enough candles"
                      : `${fmtPct(read.trendPct, { sign: true, digits: 1 })} regression · ${read.trendWindow}c`
                  }
                />
                <TechMetric
                  label="RSI 14"
                  value={read.rsi14 === null ? "—" : read.rsi14.toFixed(1)}
                  tone={
                    read.rsi14 === null
                      ? undefined
                      : read.rsi14 >= 70
                        ? "warn"
                        : read.rsi14 <= 30
                          ? "accent"
                          : undefined
                  }
                  sub={rsiLabel(read.rsi14)}
                />
                <TechMetric
                  label="ATR 14"
                  value={read.atrPct === null ? "—" : fmtPct(read.atrPct, { digits: 2 })}
                  sub="Average true range"
                />
                <TechMetric
                  label="Volume trend"
                  value={fmtPct(read.volumeTrendPct, { sign: true, digits: 0 })}
                  tone={
                    read.volumeTrendPct === null ? undefined : read.volumeTrendPct >= 0 ? "up" : "down"
                  }
                  sub="Current vs prior window"
                />
                <TechMetric
                  label="Support"
                  value={fmtPrice(read.support)}
                  sub={
                    read.supportDistancePct === null
                      ? "No level in window"
                      : `${fmtPct(read.supportDistancePct, { digits: 1 })} below price`
                  }
                />
                <TechMetric
                  label="Resistance"
                  value={fmtPrice(read.resistance)}
                  sub={
                    read.resistanceDistancePct === null
                      ? "No level in window"
                      : `${fmtPct(read.resistanceDistancePct, { digits: 1 })} above price`
                  }
                />
                <TechMetric
                  label="Range fit"
                  value={rangeFitPct === null ? "—" : fmtPct(rangeFitPct, { digits: 0 })}
                  tone={rangeFitPct === null ? undefined : rangeFitPct >= 60 ? "up" : "warn"}
                  sub="Closes inside band"
                />
                <TechMetric
                  label={`${days}D change`}
                  value={fmtPct(read.changePct, { sign: true, digits: 1 })}
                  tone={
                    read.changePct === null ? undefined : read.changePct >= 0 ? "up" : "down"
                  }
                  sub={`${read.candles} candles · ${timeframe}`}
                />
              </div>
              <div className="tech-summary">
                <Sparkles />
                <span>{readSummary}</span>
              </div>
            </div>
          </div>

          <div className="panel" style={{ background: "var(--surface-2)" }}>
            <div className="panel-head">
              <div>
                <div className="panel-title">
                  <Sparkles />
                  Strategy engine
                </div>
                <div className="panel-sub">
                  Confidence {Math.round(analysis.confidence)}% · shaped for current volatility
                </div>
              </div>
              <div className="row gap6">
                <StrategyBadge strategy={analysis.recommendedStrategy} />
                <Badge tone={analysis.safety.status === "safe" ? "green" : analysis.safety.status === "blocked" ? "red" : "amber"}>
                  {analysis.safety.status}
                </Badge>
              </div>
            </div>
            <div className="panel-body">
              <PriceRangeBar
                lower={analysis.range.lowerPrice}
                upper={analysis.range.upperPrice}
                current={pool.currentPrice}
                inRange={
                  pool.currentPrice >= analysis.range.lowerPrice &&
                  pool.currentPrice <= analysis.range.upperPrice
                }
              />
              <div className="row between mt12" style={{ fontSize: 12.5, color: "var(--text-3)" }}>
                <span>
                  Width <strong className="mono" style={{ color: "var(--text-2)" }}>{fmtPct(analysis.range.widthPct, { digits: 1 })}</strong>
                </span>
                <span>
                  Bins{" "}
                  <strong className="mono" style={{ color: "var(--text-2)" }}>
                    {analysis.range.lowerBin} → {analysis.range.upperBin}
                  </strong>
                </span>
                <span>{analysis.range.widthBins} bins wide</span>
              </div>

              {analysis.reasons.length ? (
                <div className="col gap6 mt16">
                  {analysis.reasons.map((reason) => (
                    <div className="row-top" key={reason} style={{ gap: 8 }}>
                      <CircleCheck size={13} style={{ color: "var(--accent)", marginTop: 2, flex: "none" }} />
                      <span className="sub" style={{ fontSize: 13 }}>{reason}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {analysis.warnings.length ? (
                <div className="col gap6 mt12">
                  {analysis.warnings.map((warning) => (
                    <div className="row-top" key={warning} style={{ gap: 8 }}>
                      <TriangleAlert size={13} style={{ color: "var(--amber)", marginTop: 2, flex: "none" }} />
                      <span className="sub" style={{ fontSize: 13 }}>{warning}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {analysis.riskFlags.length ? (
                <div className="row wrap gap6 mt12">
                  {analysis.riskFlags.map((flag) => (
                    <Badge
                      key={flag.code}
                      tone={flag.severity === "critical" ? "red" : flag.severity === "warning" ? "amber" : "neutral"}
                      title={flag.label}
                    >
                      {flag.label}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <div className="notice mt12" style={{ background: "var(--surface-3)" }}>
                <ShieldAlert />
                <span>
                  {analysis.safety.checked
                    ? analysis.safety.reasons[0] ?? "Token safety checks passed with no blocking flags."
                    : "Token safety is unavailable right now; this pool is treated as unverified by risk filters."}
                </span>
              </div>
            </div>
          </div>

          <div className="panel" style={{ background: "var(--surface-2)", borderColor: "var(--line-2)" }}>
            <div className="panel-head">
              <div>
                <div className="panel-title">
                  <Wallet />
                  Open a position
                </div>
                <div className="panel-sub">
                  The bot sizes both sides from the pool orientation, current price and your range.
                </div>
              </div>
              <Segmented
                value={mode}
                onChange={(value) => {
                  setMode(value);
                  setConfirmed(false);
                }}
                options={[
                  { value: "paper" as TradingMode, label: "Paper" },
                  { value: "live" as TradingMode, label: "Live" },
                ]}
                accent
                ariaLabel="Execution mode"
              />
            </div>
            <div className="panel-body">
              {mode === "live" ? (
                <div className={`notice ${liveBlockedReason ? "warn" : "accent"}`} style={{ marginBottom: 13 }}>
                  <LockKeyhole />
                  <span>
                    {liveBlockedReason
                      ? liveBlockedReason
                      : `Live armed. Real funds will be deployed from your execution wallet. Max per trade: ${
                          risk ? fmtCompact(risk.liveMaxPerTradeUsd) : "risk limit"
                        }.`}
                  </span>
                </div>
              ) : null}

              <div className="form-grid">
                <Field
                  label="Capital"
                  hint={
                    mode === "paper"
                      ? paperCash !== undefined
                        ? `Paper cash available: ${fmtCompact(paperCash)}`
                        : "Simulated capital from the paper book"
                      : risk
                        ? `Hard cap ${fmtCompact(risk.liveMaxPerTradeUsd)} per live trade`
                        : "Capped by live risk settings"
                  }
                >
                  <div className="input-wrap">
                    <input
                      className="input with-suffix"
                      inputMode="decimal"
                      value={capital}
                      onChange={(event) => setCapital(event.target.value)}
                      aria-label="Position capital in USD"
                    />
                    <span className="input-suffix">USD</span>
                  </div>
                </Field>
                <Field label="Strategy">
                  <select
                    className="select"
                    value={strategy}
                    onChange={(event) => setStrategy(event.target.value as StrategyChoice)}
                  >
                    <option value="auto">Auto · follow engine</option>
                    <option value="spot">Spot</option>
                    <option value="curve">Curve</option>
                    <option value="bidask">BidAsk</option>
                  </select>
                </Field>
                <Field label="Range width" hint={widthMode === "auto" ? "Engine optimised" : "Custom half-width from current price"}>
                  <div className="row gap6">
                    <select
                      className="select"
                      value={widthMode}
                      onChange={(event) => setWidthMode(event.target.value as "auto" | "custom")}
                      style={{ maxWidth: 120 }}
                    >
                      <option value="auto">Auto</option>
                      <option value="custom">Custom</option>
                    </select>
                    <div className="input-wrap grow">
                      <input
                        className="input with-suffix"
                        inputMode="decimal"
                        value={width}
                        disabled={widthMode === "auto"}
                        onChange={(event) => setWidth(event.target.value)}
                        aria-label="Range width percentage"
                      />
                      <span className="input-suffix">%</span>
                    </div>
                  </div>
                </Field>
                <Field label="Recommended entry">
                  <div className="input" style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-sans)" }}>
                    <StrategyBadge strategy={analysis.recommendedStrategy} />
                    <span className="dimtx">Conf. {Math.round(analysis.confidence)}%</span>
                  </div>
                </Field>
              </div>

              {mode === "live" && !liveBlockedReason ? (
                <label className="check mt12">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>
                    I understand this signs and submits real Solana transactions and can lose capital.
                    The execution wallet is a hot wallet controlled by this server.
                  </span>
                </label>
              ) : null}

              {formError ? <div className="notice danger mt12"><TriangleAlert /><span>{formError}</span></div> : null}

              <div className="row between mt16 wrap">
                <span className="dimtx">
                  {mode === "paper"
                    ? "Simulated fill · no on-chain transaction"
                    : "Signed server-side · key never exposed"}
                </span>
                <div className="row gap8">
                  {mode === "live" && liveBlockedReason ? (
                    <Link href="/settings" className="btn btn-outline btn-sm" onClick={onClose}>
                      Configure live
                    </Link>
                  ) : null}
                  <Button
                    variant={mode === "live" ? "amber" : "primary"}
                    onClick={openPosition}
                    loading={submitting}
                    disabled={!canSubmit}
                  >
                    <Wallet />
                    {mode === "live" ? "Open live position" : "Open paper position"}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="row wrap gap8" style={{ fontSize: 12.5, color: "var(--text-3)" }}>
            <span>1h fee pace {analysis.signals.feeTrend.toFixed(2)}×</span>
            <span>·</span>
            <span>Consistency {fmtPct(analysis.signals.consistency, { digits: 0 })}</span>
            <span>·</span>
            <span>
              {analysis.signals.quoteQuality >= 2
                ? "Major-quote pair"
                : analysis.signals.quoteQuality === 1
                  ? "One quote asset"
                  : "No major quote"}
            </span>
            <span>·</span>
            <span>{analysis.signals.minHolders.toLocaleString("en-US")} holders</span>
          </div>
        </div>
      )}
    </Drawer>
  );
}
