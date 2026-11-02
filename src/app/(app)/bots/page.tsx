"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Coins,
  Gauge,
  Pause,
  Pencil,
  Play,
  Plus,
  Radar,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { BotRecord, TradingMode } from "@/lib/types";
import { fmtCompact, fmtCountdown, fmtPct, fmtUsd, timeAgo } from "@/lib/client/format";
import { useBots, useDashboard, useRefreshAll } from "@/lib/client/hooks";
import { apiDelete, apiPatch, apiPost, errorMessage } from "@/lib/client/api";
import { improveHeatLabel, improveHeatTone } from "@/lib/bot/improve";
import { RISK_PROFILE_COPY } from "@/lib/defaults";
import { PageError, PageLoading } from "@/components/page-states";
import { Badge, Button, EmptyState, Modal, Panel, Segmented, Stat } from "@/components/ui";
import { BotEditor } from "@/components/bots/bot-editor";
import { useToast } from "@/components/toast";

type FleetFilter = "all" | TradingMode;
type StatusFilter = "all" | "running" | "paused";

interface RunResult {
  opened: number;
  closed: number;
  claims: number;
  rotated: number;
  skipped: string | null;
  error: string | null;
  actions: string[];
}

export default function BotsPage() {
  const toast = useToast();
  const refreshAll = useRefreshAll();
  const { data: botsData, error, isLoading, mutate } = useBots();
  const { data: dash } = useDashboard();
  const [fleet, setFleet] = useState<FleetFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BotRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BotRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const bots = botsData?.bots ?? [];
  const stats = botsData?.stats ?? [];
  const filtered = useMemo(
    () =>
      bots.filter((bot) => {
        if (fleet !== "all" && bot.mode !== fleet) return false;
        if (statusFilter === "running" && bot.status !== "running") return false;
        if (statusFilter === "paused" && bot.status === "running") return false;
        return true;
      }),
    [bots, fleet, statusFilter],
  );

  const running = bots.filter((bot) => bot.status === "running").length;
  const openPositions = stats.reduce((sum, item) => sum + item.openPositions, 0);
  const netPnl = stats.reduce((sum, item) => sum + item.netPnl, 0);
  const fees = stats.reduce((sum, item) => sum + item.fees, 0);
  const closedTotal = stats.reduce((sum, item) => sum + item.closedPositions, 0);
  const weightedWins = stats.reduce((sum, item) => sum + (item.winRate / 100) * item.closedPositions, 0);
  const winRate = closedTotal ? (weightedWins / closedTotal) * 100 : 0;
  const liveBots = bots.filter((bot) => bot.mode === "live").length;
  const readiness = dash?.liveReadiness;
  const guard = dash?.improvement;

  async function refreshNow() {
    setRefreshing(true);
    try {
      await refreshAll();
      toast.success("Autopilot refreshed");
    } catch {
      toast.error("Could not refresh the fleet");
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleStatus(bot: BotRecord) {
    setBusy(`${bot.id}:status`);
    try {
      await apiPatch(`/api/bots/${bot.id}`, {
        status: bot.status === "running" ? "paused" : "running",
      });
      toast.success(
        bot.status === "running" ? "Bot paused" : "Bot running",
        bot.status === "running" ? bot.name : `${bot.name} will act on its next cycle.`,
      );
      await refreshAll();
    } catch (caught) {
      toast.fromError("Could not change the bot state", caught);
    } finally {
      setBusy(null);
    }
  }

  async function runNow(bot: BotRecord) {
    setBusy(`${bot.id}:run`);
    try {
      const response = await apiPost<{ result: RunResult }>(`/api/bots/${bot.id}/run`);
      const result = response.result;
      if (result.error) {
        toast.error("Cycle finished with an error", result.error);
      } else {
        const actions = [
          result.opened ? `${result.opened} opened` : "",
          result.closed ? `${result.closed} closed` : "",
          result.claims ? `${result.claims} fee claim(s)` : "",
          result.rotated ? `${result.rotated} rotated` : "",
          result.skipped ? `skipped: ${result.skipped}` : "",
        ].filter(Boolean);
        toast.success(
          "Cycle complete",
          actions.length ? actions.join(" · ") : "No action was needed this tick.",
        );
      }
      await refreshAll();
    } catch (caught) {
      toast.fromError("Could not run the bot", caught);
    } finally {
      setBusy(null);
    }
  }

  async function removeBot() {
    if (!deleteTarget) return;
    setBusy(`${deleteTarget.id}:delete`);
    try {
      await apiDelete(`/api/bots/${deleteTarget.id}`);
      toast.success("Bot deleted", deleteTarget.name);
      setDeleteTarget(null);
      await refreshAll();
    } catch (caught) {
      toast.error("Could not delete the bot", errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  if (isLoading && !botsData) return <PageLoading label="Loading the autopilot fleet" />;
  if (!botsData && error) {
    return (
      <PageError
        title="The autopilot fleet could not load"
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
            <span className="eyebrow">Autopilot</span>
            <Badge tone={running ? "green" : "neutral"} dot>
              {running} running
            </Badge>
            {liveBots ? (
              <Badge tone={readiness?.canTrade ? "amber" : "neutral"}>
                {liveBots} live strateg{liveBots === 1 ? "y" : "ies"}
              </Badge>
            ) : null}
          </div>
          <h1 className="h1 mt8">Strategy fleet</h1>
          <p className="sub mt8">
            Each bot scans, enters, rebalances, claims and rotates on its own interval. Risk limits
            are enforced server-side before any transaction is built.
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" onClick={refreshNow} loading={refreshing}>
            <RefreshCw />
            Refresh
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus />
            New bot
          </Button>
        </div>
      </div>

      {liveBots && readiness && !readiness.canTrade ? (
        <div className="notice warn" style={{ marginBottom: 14 }}>
          <ShieldAlert />
          <span>
            {liveBots} live bot{liveBots === 1 ? "" : "s"} cannot act while live execution is locked.{" "}
            {readiness.reason}{" "}
            <Link href="/settings" style={{ color: "var(--accent)" }}>
              Open live controls
            </Link>
          </span>
        </div>
      ) : null}

      {guard ? (
        <div className={`improve-strip heat-${guard.heat}`}>
          <span className="improve-orb">
            <Sparkles />
          </span>
          <div className="improve-strip-body">
            <div className="improve-strip-title">
              Performance guard
              <span className="dim">paper book</span>
              <Badge
                tone={guard.enabled ? improveHeatTone(guard.heat) : "neutral"}
                dot={guard.enabled}
              >
                {guard.enabled ? improveHeatLabel(guard.heat) : "Off"}
              </Badge>
              {guard.pauseEntries ? <Badge tone="red">entries paused</Badge> : null}
            </div>
            <div className="improve-strip-sub">
              {guard.enabled ? (
                <>
                  Sizing ×{guard.capitalScale.toFixed(2)} · score floor{" "}
                  {guard.entryScoreFloorDelta > 0 ? "+" : ""}
                  {guard.entryScoreFloorDelta} pts · rotation edge +{guard.rotationDeltaBonus} pts ·{" "}
                  {guard.blockedPools.length} pool{guard.blockedPools.length === 1 ? "" : "s"} cooling
                  · {guard.sampleTrades} trade{guard.sampleTrades === 1 ? "" : "s"} sampled
                </>
              ) : (
                "Adaptive guard is off for every running paper bot."
              )}
            </div>
          </div>
          <span className="improve-strip-note">
            {guard.pauseEntries
              ? `${guard.pauseReason}${guard.pauseUntil ? ` · ${fmtCountdown(guard.pauseUntil)} left` : ""}`
              : (guard.actions[0] ?? "Guard is learning from closed trades.")}
          </span>
          <Link href="/dashboard" className="btn btn-ghost btn-sm improve-strip-link">
            Detail
            <ArrowRight />
          </Link>
        </div>
      ) : null}

      <div className="stats-strip">
        <Stat
          label="Fleet"
          hero
          icon={<Bot />}
          value={bots.length}
          sub={`${bots.filter((bot) => bot.mode === "paper").length} paper · ${liveBots} live`}
        />
        <Stat
          label="Running"
          icon={<Zap />}
          value={running}
          sub={`${bots.length - running} paused`}
        />
        <Stat
          label="Open positions"
          icon={<Gauge />}
          value={openPositions}
          sub="Across every strategy"
        />
        <Stat
          label="Net P&L"
          icon={<Coins />}
          value={<span className={netPnl >= 0 ? "up" : "down"}>{fmtUsd(netPnl, { sign: true })}</span>}
          sub={`${fmtUsd(fees)} fees generated`}
        />
        <Stat
          label="Closed trades"
          icon={<Radar />}
          value={closedTotal}
          sub={closedTotal ? `${Math.round(weightedWins)} winners across bots` : "No trades settled yet"}
        />
        <Stat
          label="Win rate"
          icon={<Gauge />}
          value={closedTotal ? fmtPct(winRate, { digits: 0 }) : "—"}
          sub={closedTotal ? "Weighted across bots" : "Needs closed trades"}
        />
      </div>

      <div className="row between wrap mt16" style={{ marginBottom: 14 }}>
        <div className="row gap8 wrap">
          <Segmented<FleetFilter>
            value={fleet}
            onChange={setFleet}
            size="sm"
            options={[
              { value: "all", label: "All", count: bots.length },
              { value: "paper", label: "Paper", count: bots.filter((bot) => bot.mode === "paper").length },
              { value: "live", label: "Live", count: liveBots },
            ]}
            ariaLabel="Fleet mode"
          />
          <Segmented<StatusFilter>
            value={statusFilter}
            onChange={setStatusFilter}
            size="sm"
            options={[
              { value: "all", label: "Any state" },
              { value: "running", label: "Running", count: running },
              { value: "paused", label: "Paused", count: bots.length - running },
            ]}
            ariaLabel="Bot state"
          />
        </div>
        <span className="dimtx">
          {filtered.length} of {bots.length} shown · manual entries get their own paused bot.
        </span>
      </div>

      {filtered.length ? (
        <div className="grid" style={{ gap: 14 }}>
          {filtered.map((bot) => {
            const botStats = stats.find((item) => item.botId === bot.id);
            const profile = RISK_PROFILE_COPY[bot.config.riskProfile];
            const isManual = bot.name.startsWith("Manual desk");
            return (
              <article className="panel" key={bot.id}>
                <div className="panel-body">
                  <div className="row between wrap" style={{ gap: 12, alignItems: "flex-start" }}>
                    <div className="row-top" style={{ gap: 10, minWidth: 0 }}>
                      <span className="avatar">
                        <Bot />
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="row gap6 wrap">
                          <span className="h3 truncate">{bot.name}</span>
                          <Badge
                            tone={
                              bot.status === "running"
                                ? "green"
                                : bot.status === "error"
                                  ? "red"
                                  : "neutral"
                            }
                            dot
                          >
                            {bot.status}
                          </Badge>
                          <Badge tone={bot.mode === "live" ? "amber" : "neutral"}>{bot.mode}</Badge>
                          {bot.config.autoImprove ? (
                            <Badge
                              tone="violet"
                              title="Sizing, entry filters and re-entry bans adapt from this bot's closed trades."
                            >
                              auto-improve
                            </Badge>
                          ) : null}
                          {isManual ? <Badge tone="cyan">manual desk</Badge> : null}
                        </div>
                        <div className="mini-sub">
                          <span style={{ color: profile.accent }}>{profile.label}</span>
                          <span>·</span>
                          <span>{profile.tldr}</span>
                        </div>
                      </div>
                    </div>
                    <div className="row gap6 wrap">
                      <Button
                        size="sm"
                        variant={bot.status === "running" ? "secondary" : "primary"}
                        onClick={() => toggleStatus(bot)}
                        loading={busy === `${bot.id}:status`}
                      >
                        {bot.status === "running" ? <Pause /> : <Play />}
                        {bot.status === "running" ? "Pause" : "Start"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => runNow(bot)}
                        loading={busy === `${bot.id}:run`}
                        title="Run one cycle now"
                      >
                        <Zap />
                        Run now
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setEditing(bot);
                          setEditorOpen(true);
                        }}
                        title="Edit strategy"
                        aria-label={`Edit ${bot.name}`}
                      >
                        <Pencil />
                      </Button>
                      {bot.mode === "paper" ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteTarget(bot)}
                          disabled={bot.status === "running"}
                          title={bot.status === "running" ? "Pause before deleting" : "Delete bot"}
                          aria-label={`Delete ${bot.name}`}
                        >
                          <Trash2 />
                        </Button>
                      ) : (
                        <span
                          className="icon-btn"
                          title="Live bots retain their audit trail and cannot be deleted"
                        >
                          <ShieldAlert />
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid g4 mt16">
                    <div>
                      <div className="pm-label">Capital / position</div>
                      <div className="pm-value">{fmtUsd(bot.config.capitalPerPositionUsd)}</div>
                    </div>
                    <div>
                      <div className="pm-label">Max positions</div>
                      <div className="pm-value">{bot.config.maxOpenPositions}</div>
                    </div>
                    <div>
                      <div className="pm-label">Min score</div>
                      <div className="pm-value">{fmtPct(bot.config.minScore, { digits: 0 })}</div>
                    </div>
                    <div>
                      <div className="pm-label">Interval</div>
                      <div className="pm-value">
                        {bot.config.intervalSeconds < 60
                          ? `${bot.config.intervalSeconds}s`
                          : `${Math.round(bot.config.intervalSeconds / 60)}m`}
                      </div>
                    </div>
                  </div>

                  <div className="row between wrap mt12" style={{ gap: 8 }}>
                    <div className="hint">
                      {bot.config.protocols.map((protocol) => (protocol === "dlmm" ? "DLMM" : "DAMM v2")).join(" + ")}
                      {" · "}Fee floor {fmtPct(bot.config.minFeeAprPct, { digits: 0 })}
                      {" · "}Range {bot.config.rangeMode === "auto" ? "auto" : `${bot.config.rangeWidthPct}%`}
                      {" · "}SL {fmtPct(bot.config.stopLossPct, { digits: 0 })} / TP{" "}
                      {fmtPct(bot.config.takeProfitPct, { digits: 0 })}
                      {" · "}Slippage {(bot.config.slippageBps / 100).toFixed(2)}%
                      {bot.config.compound ? " · compounding" : ""}
                      {bot.config.rotationEnabled ? " · rotation on" : ""}
                    </div>
                    <div className="row gap12" style={{ fontSize: 13, color: "var(--text-3)" }}>
                      <span>
                        Open <strong className="mono" style={{ fontWeight: 500, color: "var(--text-2)" }}>{botStats?.openPositions ?? 0}</strong>
                      </span>
                      <span>
                        Net{" "}
                        <strong
                          className={`mono ${(botStats?.netPnl ?? 0) >= 0 ? "up" : "down"}`}
                          style={{ fontWeight: 500 }}
                        >
                          {fmtUsd(botStats?.netPnl ?? 0, { sign: true })}
                        </strong>
                      </span>
                      <span>
                        Wins{" "}
                        <strong className="mono" style={{ fontWeight: 500, color: "var(--text-2)" }}>
                          {botStats && botStats.closedPositions > 0
                            ? fmtPct(botStats.winRate, { digits: 0 })
                            : "—"}
                        </strong>
                      </span>
                      <span>{bot.lastRunAt ? `ran ${timeAgo(bot.lastRunAt)}` : "never ran"}</span>
                    </div>
                  </div>

                  {bot.lastError ? (
                    <div className="notice danger mt12">
                      <TriangleAlert />
                      <span>{bot.lastError}</span>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Panel>
          <EmptyState
            icon={<Bot />}
            title={bots.length ? "No bots match this view" : "Build your first strategy"}
            message={
              bots.length
                ? "Change the mode or state filter, or create another bot for this market."
                : "Choose a risk profile, capital per position, pool filters and an interval. It starts paused so you can inspect the plan first."
            }
            action={
              bots.length ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFleet("all");
                    setStatusFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setEditing(null);
                    setEditorOpen(true);
                  }}
                >
                  <Plus />
                  Create a bot
                </Button>
              )
            }
          />
        </Panel>
      )}

      <div className="hint mt16">
        The server scheduler evaluates running bots on their own interval. Opening a manual position
        creates a paused “Manual desk” bot so every trade stays attributable. The kill switch pauses
        the whole fleet instantly.
      </div>

      <BotEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        bot={editing}
        readiness={
          readiness ?? {
            globallyEnabled: false,
            rpcReady: false,
            rpcReason: null,
            armedUntil: null,
            armed: false,
            killSwitch: false,
            wallet: null,
            canTrade: false,
            reason: "Loading live readiness…",
          }
        }
        onSaved={() => {
          void refreshAll();
        }}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "bot"}`}
        subtitle="This removes the strategy. Closed trade history remains in Activity."
        icon={<Trash2 />}
        size="sm"
        footer={
          <div className="row between w-full">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={Boolean(busy)}>
              Keep bot
            </Button>
            <Button
              variant="danger"
              onClick={removeBot}
              loading={busy === `${deleteTarget?.id}:delete`}
            >
              Delete bot
            </Button>
          </div>
        }
      >
        <p className="sub">
          Only paused bots with no open positions can be deleted. Live bots retain their audit trail
          and cannot be removed.
        </p>
      </Modal>
    </div>
  );
}
