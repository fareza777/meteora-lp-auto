"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Coins,
  Gauge,
  Percent,
  Plus,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sigma,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { PositionStatus, TradingMode } from "@/lib/types";
import { fmtPct, fmtUsd } from "@/lib/client/format";
import { useDashboard, useRefreshAll } from "@/lib/client/hooks";
import { PageError, PageLoading } from "@/components/page-states";
import { Badge, Button, EmptyState, Panel, Segmented, Stat } from "@/components/ui";
import { PositionCard } from "@/components/positions/position-card";
import { EmergencyExitModal } from "@/components/live/emergency-exit";
import { useToast } from "@/components/toast";

type StatusFilter = "open" | "closed" | "all";

export default function PositionsPage() {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const { data, error, isLoading, mutate } = useDashboard();
  const [mode, setMode] = useState<TradingMode>("paper");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [exitOpen, setExitOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const book = useMemo(
    () => (data?.positions ?? []).filter((position) => position.mode === mode),
    [data?.positions, mode],
  );
  const visible = useMemo(
    () =>
      book.filter((position) =>
        status === "all" ? true : (position.status as PositionStatus) === status,
      ),
    [book, status],
  );
  const open = book.filter((position) => position.status === "open");
  const closed = book.filter((position) => position.status === "closed");
  const summary = mode === "live" ? data?.liveSummary : data?.summary;
  const openCapital = open.reduce((sum, position) => sum + position.capitalUsd, 0);
  const liveReady = data?.liveReadiness.canTrade ?? false;

  async function refreshNow() {
    setRefreshing(true);
    try {
      await mutate();
      toast.success("Positions refreshed");
    } catch {
      toast.error("Could not refresh positions");
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading && !data) return <PageLoading label="Loading positions" />;
  if (!data || !summary) {
    return (
      <PageError
        title="Positions could not load"
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
            <span className="eyebrow">Position book</span>
            <Badge tone={mode === "live" ? "amber" : "neutral"} dot>
              {mode === "live" ? "Real capital" : "Simulated"}
            </Badge>
            <span className="dimtx">{open.length} open · {closed.length} closed</span>
          </div>
          <h1 className="h1 mt8">Positions</h1>
          <p className="sub mt8">
            Every range, fee claim and exit in one place. Closing a position realises its mark into
            the {mode === "live" ? "execution wallet" : "paper book"}.
          </p>
        </div>
        <div className="page-actions">
          <Segmented<TradingMode>
            value={mode}
            onChange={(next) => {
              setMode(next);
              setStatus("open");
            }}
            options={[
              { value: "paper", label: "Paper", count: data.summary.openPositions },
              { value: "live", label: "Live", count: data.liveSummary.openPositions },
            ]}
            ariaLabel="Position book"
          />
          <Button variant="secondary" onClick={refreshNow} loading={refreshing}>
            <RefreshCw />
            Refresh
          </Button>
          <Link href="/scanner" className="btn btn-primary">
            <Plus />
            Open position
          </Link>
        </div>
      </div>

      {mode === "live" && !liveReady ? (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <ShieldAlert />
          <span>
            Live entries are locked until every live gate is green. You can still close or claim on
            existing positions when the execution wallet is configured.{" "}
            <Link href="/settings" style={{ color: "var(--accent)" }}>
              Review live controls
            </Link>
          </span>
        </div>
      ) : null}

      <div className="stats-strip">
        <Stat
          label="Open positions"
          hero
          icon={<Wallet />}
          value={open.length}
          sub={`${closed.length} closed · limit ${data.settings.risk.maxOpenPositions}`}
        />
        <Stat
          label="Capital deployed"
          icon={<Gauge />}
          value={fmtUsd(openCapital)}
          sub={`${fmtPct(summary.exposurePct, { digits: 0 })} of equity`}
        />
        <Stat
          label="Open P&L"
          icon={<TrendingUp />}
          value={
            <span className={summary.unrealizedPnl >= 0 ? "up" : "down"}>
              {fmtUsd(summary.unrealizedPnl, { sign: true })}
            </span>
          }
          sub={`${fmtUsd(summary.positionsValue)} position value`}
        />
        <Stat
          label="Unclaimed fees"
          icon={<Coins />}
          value={<span className="up">{fmtUsd(summary.unclaimedFees)}</span>}
          sub={`${fmtUsd(summary.feeIncome)} lifetime`}
        />
        <Stat
          label="Realised P&L"
          icon={<Percent />}
          value={
            <span className={summary.realizedPnl >= 0 ? "up" : "down"}>
              {fmtUsd(summary.realizedPnl, { sign: true })}
            </span>
          }
          sub={
            mode === "paper"
              ? `${closed.length} closed · ${closed.filter((position) => position.pnlUsd > 0).length} winners · after fees`
              : `${closed.length} closed · ${closed.filter((position) => position.pnlUsd > 0).length} winners`
          }
        />
        <Stat
          label="Net P&L"
          icon={<Sigma />}
          value={
            <span className={summary.totalPnl >= 0 ? "up" : "down"}>
              {fmtUsd(summary.totalPnl, { sign: true })}
            </span>
          }
          sub={`${fmtUsd(summary.equity)} equity · ${fmtPct(summary.totalPnlPct, { sign: true })}`}
        />
      </div>

      <p className="dimtx mt10" style={{ lineHeight: 1.55 }}>
        <strong style={{ color: "var(--text)" }}>Open P&L</strong>{" "}
        <span className={summary.unrealizedPnl >= 0 ? "up" : "down"}>
          {fmtUsd(summary.unrealizedPnl, { sign: true })}
        </span>{" "}
        + <strong style={{ color: "var(--text)" }}>realised P&L</strong>{" "}
        <span className={summary.realizedPnl >= 0 ? "up" : "down"}>
          {fmtUsd(summary.realizedPnl, { sign: true })}
        </span>{" "}
        = <strong style={{ color: "var(--text)" }}>net P&L</strong>{" "}
        <span className={summary.totalPnl >= 0 ? "up" : "down"}>
          {fmtUsd(summary.totalPnl, { sign: true })}
        </span>
        . Open P&L marks the live book including claimable fees; realised P&L books closed trades
        after network fees, so a losing realised total can still sit inside a profitable portfolio.
      </p>

      <div className="row between wrap mt16" style={{ marginBottom: 14 }}>
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          size="sm"
          options={[
            { value: "open", label: "Open", count: open.length },
            { value: "closed", label: "Closed", count: closed.length },
            { value: "all", label: "All", count: book.length },
          ]}
          ariaLabel="Position status"
        />
        <div className="row gap6">
          <Button variant="danger" size="sm" onClick={() => setExitOpen(true)}>
            <ShieldAlert />
            Emergency exit
          </Button>
        </div>
      </div>

      {visible.length ? (
        <div className="grid g2">
          {visible.map((position) => (
            <PositionCard
              key={position.id}
              position={position}
              onChanged={() => {
                void refreshAll();
              }}
            />
          ))}
        </div>
      ) : (
        <Panel>
          <EmptyState
            icon={status === "closed" ? <Gauge /> : <Radar />}
            title={
              status === "closed"
                ? `No closed ${mode} positions yet`
                : status === "open"
                  ? `No open ${mode} positions`
                  : `The ${mode} book is empty`
            }
            message={
              status === "closed"
                ? "Closed trades and their realised P&L will appear here."
                : "Pick a pool from the scanner, review the AI brief and open a position with your risk limits applied automatically."
            }
            action={
              status === "closed" ? (
                <Button variant="secondary" size="sm" onClick={() => setStatus("open")}>
                  View open book
                </Button>
              ) : (
                <Link href="/scanner" className="btn btn-primary btn-sm">
                  <Radar />
                  Scan pools
                </Link>
              )
            }
          />
        </Panel>
      )}

      <div className="hint mt16">
        Fees are marked continuously; claimed fees move to cash. Closing a live position returns
        funds to the encrypted execution wallet — withdraw them to your signed-in wallet from the
        Live console.
      </div>

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
