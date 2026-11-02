"use client";

import { useEffect, useState } from "react";
import {
  Database,
  Percent,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Waves,
} from "lucide-react";
import type { PoolAnalysis, Protocol } from "@/lib/types";
import { fmtCompact, fmtPct, timeAgo } from "@/lib/client/format";
import { useDashboard, useDebouncedValue, useRefreshAll, useScanner } from "@/lib/client/hooks";
import { PageError, PageLoading } from "@/components/page-states";
import { Badge, Button, EmptyState, Panel, ScoreRing, Segmented, Stat } from "@/components/ui";
import { PoolCard } from "@/components/market/pool-card";
import { PoolDrawer, type PoolSelection } from "@/components/market/pool-drawer";
import { PoolPair, ProtocolBadge, RiskBadge, StrategyBadge, protocolLabel } from "@/components/market/pool-visuals";
import { useToast } from "@/components/toast";

type Sort = "score" | "feeApr" | "tvl" | "volume" | "risk" | "age";
type ProtocolFilter = "all" | Protocol;
type View = "cards" | "table";

const SORTS: { value: Sort; label: string }[] = [
  { value: "score", label: "Best score" },
  { value: "feeApr", label: "Highest fee APR" },
  { value: "tvl", label: "Deepest TVL" },
  { value: "volume", label: "Highest volume" },
  { value: "risk", label: "Lowest risk" },
  { value: "age", label: "Oldest pool" },
];

const TVL_STEPS = [
  { value: 0, label: "Any TVL" },
  { value: 150_000, label: "$150K+ TVL" },
  { value: 500_000, label: "$500K+ TVL" },
  { value: 1_000_000, label: "$1M+ TVL" },
  { value: 5_000_000, label: "$5M+ TVL" },
];

const SCORE_STEPS = [
  { value: 0, label: "Any score" },
  { value: 50, label: "Score 50+" },
  { value: 62, label: "Score 62+" },
  { value: 70, label: "Score 70+" },
  { value: 80, label: "Score 80+" },
];

const RISK_STEPS = [
  { value: 0, label: "Any risk" },
  { value: 40, label: "Risk ≤ 40" },
  { value: 55, label: "Risk ≤ 55" },
  { value: 70, label: "Risk ≤ 70" },
];

export default function ScannerPage() {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const { data: dash } = useDashboard();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 400);
  const [protocol, setProtocol] = useState<ProtocolFilter>("all");
  const [sort, setSort] = useState<Sort>("score");
  const [minTvl, setMinTvl] = useState(0);
  const [minScore, setMinScore] = useState(0);
  const [maxRisk, setMaxRisk] = useState(0);
  const [view, setView] = useState<View>("cards");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<PoolSelection | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState(40);

  const { data, error, isLoading, mutate } = useScanner({
    search: debouncedSearch,
    protocol,
    sort,
    minTvl,
    minScore,
    maxRisk,
    limit: 250,
  });

  useEffect(() => {
    setVisible(40);
  }, [debouncedSearch, protocol, sort, minTvl, minScore, maxRisk]);

  const pools = data?.pools ?? [];
  const shownPools = pools.slice(0, visible);
  const stats = data?.stats;
  const filtered = Boolean(search || minTvl || minScore || maxRisk || protocol !== "all");
  const advancedFilters =
    (protocol !== "all" ? 1 : 0) + (minTvl ? 1 : 0) + (minScore ? 1 : 0) + (maxRisk ? 1 : 0);
  const aprPools = pools.filter((pool) => pool.pool.tvlUsd >= 1_000_000);
  const bestApr = (aprPools.length ? aprPools : pools).reduce(
    (best, pool) => Math.max(best, pool.feeAprPct),
    0,
  );
  const medianScore = pools.length
    ? [...pools].map((pool) => pool.score).sort((a, b) => a - b)[Math.floor(pools.length / 2)]
    : 0;

  function openPool(analysis: PoolAnalysis) {
    setSelected({ protocol: analysis.pool.protocol, address: analysis.pool.address });
  }

  function resetFilters() {
    setSearch("");
    setProtocol("all");
    setSort("score");
    setMinTvl(0);
    setMinScore(0);
    setMaxRisk(0);
  }

  function applyPreset(preset: "bluechip" | "yield" | "fresh") {
    if (preset === "bluechip") {
      setProtocol("all");
      setSort("score");
      setMinTvl(1_000_000);
      setMinScore(68);
      setMaxRisk(40);
    }
    if (preset === "yield") {
      setProtocol("all");
      setSort("feeApr");
      setMinTvl(150_000);
      setMinScore(50);
      setMaxRisk(65);
    }
    if (preset === "fresh") {
      setProtocol("dlmm");
      setSort("age");
      setMinTvl(150_000);
      setMinScore(55);
      setMaxRisk(60);
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    try {
      await mutate();
      toast.success("Scanner refreshed", "Meteora data pulled from the live indexer.");
    } catch {
      toast.error("Scanner refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading && !data) return <PageLoading label="Scanning Meteora pools" />;
  if (!data && error) {
    return (
      <PageError
        title="The scanner is offline"
        message={error instanceof Error ? error.message : undefined}
        onRetry={() => mutate()}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="lede">
          <div className="row gap8 wrap">
            <span className="eyebrow">Market intelligence</span>
            <Badge tone={data?.stale ? "amber" : "green"} dot>
              {data?.stale ? "Cached feed" : "Live feed"}
            </Badge>
            {data?.cachedAt ? <span className="dimtx">synced {timeAgo(data.cachedAt)}</span> : null}
          </div>
          <h1 className="h1 mt8">Pool scanner</h1>
          <p className="sub mt8">
            Every pool is scored on real fee flow, volume, liquidity, volatility, token safety and
            profit consistency. Open a pool for the full AI brief and an executable range.
          </p>
        </div>
        <div className="page-actions">
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: "Cards" },
              { value: "table", label: "Table" },
            ]}
            ariaLabel="Scanner layout"
          />
          <Button variant="secondary" onClick={refreshNow} loading={refreshing}>
            <RefreshCw />
            Refresh
          </Button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-body" style={{ padding: "12px 14px" }}>
          <div className="toolbar">
            <div className="search-box">
              <Search />
              <input
                className="input"
                placeholder="Search token, pair or pool address"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search pools"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="filter-toggle"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
            >
              <SlidersHorizontal />
              Filters{advancedFilters ? ` · ${advancedFilters}` : ""}
            </Button>
            <div className={filtersOpen ? "filter-extra is-open" : "filter-extra"}>
              <Segmented<ProtocolFilter>
                value={protocol}
                onChange={setProtocol}
                size="sm"
                options={[
                  { value: "all", label: "All pools" },
                  { value: "dlmm", label: "DLMM" },
                  { value: "damm-v2", label: "DAMM v2" },
                ]}
                ariaLabel="Protocol"
              />
              <select
                className="select"
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                aria-label="Sort pools"
              >
                {SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={minTvl}
                onChange={(event) => setMinTvl(Number(event.target.value))}
                aria-label="Minimum TVL"
              >
                {TVL_STEPS.map((step) => (
                  <option key={step.value} value={step.value}>
                    {step.label}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={minScore}
                onChange={(event) => setMinScore(Number(event.target.value))}
                aria-label="Minimum score"
              >
                {SCORE_STEPS.map((step) => (
                  <option key={step.value} value={step.value}>
                    {step.label}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={maxRisk}
                onChange={(event) => setMaxRisk(Number(event.target.value))}
                aria-label="Maximum risk"
              >
                {RISK_STEPS.map((step) => (
                  <option key={step.value} value={step.value}>
                    {step.label}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={resetFilters} disabled={!filtered}>
                <RotateCcw />
                Reset
              </Button>
            </div>
          </div>
          <div className="row gap6 wrap mt12">
            <span className="dimtx" style={{ marginRight: 2 }}>Presets</span>
            <button type="button" className="chip" onClick={() => applyPreset("bluechip")}>
              <ShieldAlert />
              Blue chip
            </button>
            <button type="button" className="chip" onClick={() => applyPreset("yield")}>
              <TrendingUp />
              High yield
            </button>
            <button type="button" className="chip" onClick={() => applyPreset("fresh")}>
              <Waves />
              New DLMM
            </button>
          </div>
        </div>
      </div>

      <div className="stats-strip">
        <Stat
          label="Pools matched"
          hero
          icon={<Radar />}
          value={data?.universe.matched ?? pools.length}
          sub={`${data?.universe.total ?? 0} viable pools scanned`}
        />
        <Stat
          label="Protocol TVL"
          icon={<Database />}
          value={fmtCompact(stats?.totalTvlUsd ?? 0)}
          sub="DLMM + DAMM v2"
        />
        <Stat
          label="24h volume"
          icon={<Waves />}
          value={fmtCompact(stats?.volume24hUsd ?? 0)}
          sub="Rolling window"
        />
        <Stat
          label="24h fees"
          icon={<Percent />}
          value={fmtCompact(stats?.fee24hUsd ?? 0)}
          sub="Paid to LPs"
        />
        <Stat
          label="Best fee APR"
          icon={<Sparkles />}
          value={fmtPct(bestApr, { digits: 0 })}
          sub={aprPools.length ? "Pools with ≥ $1M TVL" : "Within this result set"}
        />
        <Stat
          label="Median score"
          icon={<ShieldAlert />}
          value={medianScore ? Math.round(medianScore) : "—"}
          sub="Risk-adjusted quality"
        />
      </div>

      {error && data ? (
        <div className="notice warn mt16">
          <ShieldAlert />
          <span>Showing the last cached scan. The latest refresh failed; retry when the indexer responds.</span>
        </div>
      ) : null}

      <div className="mt16">
        {pools.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<Search />}
              title="No pools matched those filters"
              message="Loosen the risk ceiling or lower the TVL floor. The scanner only ranks pools that pass the safety screen you selected."
              action={
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  <RotateCcw />
                  Reset filters
                </Button>
              }
            />
          </Panel>
        ) : view === "cards" ? (
          <div className="grid g2">
            {shownPools.map((analysis) => (
              <PoolCard
                key={`${analysis.pool.protocol}:${analysis.pool.address}`}
                analysis={analysis}
                onOpen={openPool}
              />
            ))}
          </div>
        ) : (
          <Panel flush>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Pool</th>
                    <th>Fee APR</th>
                    <th className="hide-sm">24h fees</th>
                    <th className="hide-sm">TVL</th>
                    <th className="hide-sm">Volume</th>
                    <th className="hide-sm">Volatility</th>
                    <th>Risk</th>
                    <th>Score</th>
                    <th className="hide-sm">Strategy</th>
                  </tr>
                </thead>
                <tbody>
                  {shownPools.map((analysis) => (
                    <tr
                      key={`${analysis.pool.protocol}:${analysis.pool.address}`}
                      onClick={() => openPool(analysis)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") openPool(analysis);
                      }}
                      role="button"
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <div className="cell-main">
                          <PoolPair pool={analysis.pool} />
                          <span className="pool-name truncate">
                            {analysis.pool.tokenX.symbol}/{analysis.pool.tokenY.symbol}
                          </span>
                        </div>
                        <div className="cell-sub">
                          {protocolLabel(analysis.pool.protocol)} · {analysis.pool.binStep} bp bin ·{" "}
                          {analysis.signals.ageHours < 1
                            ? "new"
                            : `${Math.round(analysis.signals.ageHours)}h old`}
                        </div>
                      </td>
                      <td>
                        <span className="mono">{fmtPct(analysis.feeAprPct, { digits: 0 })}</span>
                        <div className="cell-sub">{fmtPct(analysis.netAprPct, { digits: 0 })} net</div>
                      </td>
                      <td className="hide-sm mono up">{fmtCompact(analysis.pool.fees24hUsd)}</td>
                      <td className="hide-sm mono">{fmtCompact(analysis.pool.tvlUsd)}</td>
                      <td className="hide-sm mono">{fmtCompact(analysis.pool.volume24hUsd)}</td>
                      <td className="hide-sm mono">{fmtPct(analysis.volatilityPct, { digits: 1 })}</td>
                      <td>
                        <RiskBadge
                          score={analysis.riskScore}
                          flags={analysis.riskFlags.filter((flag) => flag.severity !== "info").length}
                        />
                      </td>
                      <td>
                        <ScoreRing value={analysis.score} size={30} />
                      </td>
                      <td className="hide-sm">
                        <StrategyBadge strategy={analysis.recommendedStrategy} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>

      {pools.length > shownPools.length ? (
        <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
          <Button variant="secondary" onClick={() => setVisible((value) => value + 40)}>
            Show {Math.min(40, pools.length - shownPools.length)} more pools
          </Button>
        </div>
      ) : null}

      <div className="row between wrap mt16">
        <span className="dimtx">
          {data?.universe.matched ?? pools.length} pools matched from {data?.universe.total ?? 0}{" "}
          viable pools ({data?.universe.dlmm ?? 0} DLMM · {data?.universe.damm ?? 0} DAMM v2) ·{" "}
          {data?.universe.deep ?? 0} deep-analysed · DAMM v2 is paper-only for live execution.
        </span>
        <div className="row gap6">
          <span className="dimtx">
            Showing {shownPools.length} of {pools.length}
          </span>
          <ProtocolBadge protocol="dlmm" />
          <ProtocolBadge protocol="damm-v2" />
        </div>
      </div>

      <PoolDrawer
        selection={selected}
        onClose={() => setSelected(null)}
        liveReadiness={dash?.liveReadiness ?? null}
        paperCash={dash?.paper.cash}
        risk={dash?.settings.risk}
        onOpened={() => {
          void refreshAll();
        }}
      />
    </div>
  );
}
