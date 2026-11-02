"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  Download,
  ExternalLink,
  Filter,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { TransactionRecord } from "@/lib/types";
import { fmtDate, fmtUsd, timeAgo } from "@/lib/client/format";
import { useActivity } from "@/lib/client/hooks";
import { explorerTx } from "@/lib/client/wallet";
import { PageError, PageLoading } from "@/components/page-states";
import { Badge, Button, EmptyState, Panel, Segmented, Stat, type Tone } from "@/components/ui";
import { useToast } from "@/components/toast";

type View = "log" | "transactions";
type LevelFilter = "all" | "info" | "success" | "warning" | "error";

const STATUS_TONE: Record<TransactionRecord["status"], Tone> = {
  confirmed: "green",
  simulated: "cyan",
  pending: "amber",
  failed: "red",
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export default function ActivityPage() {
  const toast = useToast();
  const { data, error, isLoading, mutate } = useActivity(300);
  const [view, setView] = useState<View>("log");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const activity = data?.activity ?? [];
  const transactions = data?.transactions ?? [];
  const categories = useMemo(
    () => Array.from(new Set(activity.map((item) => item.category))).sort(),
    [activity],
  );
  const query = search.trim().toLowerCase();
  const filteredActivity = useMemo(
    () =>
      activity.filter((item) => {
        if (level !== "all" && item.level !== level) return false;
        if (category !== "all" && item.category !== category) return false;
        if (query && !`${item.message} ${item.category}`.toLowerCase().includes(query)) return false;
        return true;
      }),
    [activity, level, category, query],
  );
  const filteredTransactions = useMemo(
    () =>
      transactions.filter((item) => {
        if (query) {
          const haystack = `${item.type} ${item.mode} ${item.status} ${item.poolName ?? ""} ${item.signature ?? ""}`;
          if (!haystack.toLowerCase().includes(query)) return false;
        }
        return true;
      }),
    [transactions, query],
  );
  const filtered = level !== "all" || category !== "all" || Boolean(query);  const confirmed = transactions.filter((item) => item.status === "confirmed").length;
  const simulated = transactions.filter((item) => item.status === "simulated").length;
  const failed = transactions.filter((item) => item.status === "failed").length;
  const riskEvents = activity.filter((item) => item.category === "risk").length;

  async function refreshNow() {
    setRefreshing(true);
    try {
      await mutate();
      toast.success("Activity refreshed");
    } catch {
      toast.error("Could not refresh activity");
    } finally {
      setRefreshing(false);
    }
  }

  function exportCsv() {
    if (!filteredTransactions.length) return;
    const header = [
      "Time",
      "Type",
      "Mode",
      "Status",
      "Pool",
      "Amount USD",
      "Fee USD",
      "Network fee USD",
      "Signature",
    ];
    const rows = filteredTransactions.map((item) => [
      new Date(item.createdAt).toISOString(),
      item.type,
      item.mode,
      item.status,
      item.poolName ?? "",
      item.amountUsd.toFixed(2),
      item.feeUsd.toFixed(2),
      item.networkFeeUsd.toFixed(4),
      item.signature ?? "",
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tide-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported", `${filteredTransactions.length} transactions written.`);
  }

  function resetFilters() {
    setLevel("all");
    setCategory("all");
    setSearch("");
  }

  if (isLoading && !data) return <PageLoading label="Loading the audit trail" />;
  if (!data) {
    return (
      <PageError
        title="Activity could not load"
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
            <span className="eyebrow">Audit trail</span>
            <Badge tone="cyan" dot>
              Server logged
            </Badge>
            <span className="dimtx">Entries, exits, claims, risk checks and live gates</span>
          </div>
          <h1 className="h1 mt8">Activity</h1>
          <p className="sub mt8">
            A complete, timestamped record of what the desk did and why. Paper fills are marked as
            simulated; live transactions carry their on-chain signature.
          </p>
        </div>
        <div className="page-actions">
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: "log", label: "Decision log", count: filteredActivity.length },
              { value: "transactions", label: "Transactions", count: filteredTransactions.length },
            ]}
            ariaLabel="Activity view"
          />
          <Button variant="secondary" onClick={refreshNow} loading={refreshing}>
            <RefreshCw />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!filteredTransactions.length}>
            <Download />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="stats-strip">
        <Stat
          label="Events"
          hero
          icon={<ActivityIcon />}
          value={activity.length}
          sub={`${filteredActivity.length} in current view`}
        />
        <Stat
          label="Transactions"
          icon={<ArrowUpRight />}
          value={transactions.length}
          sub="Paper + live"
        />
        <Stat
          label="Confirmed"
          icon={<ShieldAlert />}
          value={confirmed}
          sub="On-chain"
        />
        <Stat
          label="Simulated"
          icon={<ActivityIcon />}
          value={simulated}
          sub="Paper fills"
        />
        <Stat
          label="Failed"
          icon={<TriangleAlert />}
          value={failed}
          sub="Needs review"
        />
        <Stat
          label="Risk events"
          icon={<ShieldAlert />}
          value={riskEvents}
          sub="Kill switch, limits, exits"
        />
      </div>

      <div className="panel" style={{ marginTop: 14, marginBottom: 14 }}>
        <div className="panel-body" style={{ padding: "12px 14px" }}>
          <div className="toolbar">
            <div className="search-box">
              <Search />
              <input
                className="input"
                placeholder={view === "log" ? "Search decisions" : "Search pool, type or signature"}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search activity"
              />
            </div>
            {view === "log" ? (
              <>
                <select
                  className="select"
                  value={level}
                  onChange={(event) => setLevel(event.target.value as LevelFilter)}
                  aria-label="Filter level"
                >
                  <option value="all">Any level</option>
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                  <option value="error">Error</option>
                </select>
                <select
                  className="select"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  aria-label="Filter category"
                >
                  <option value="all">Any category</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={resetFilters} disabled={!filtered}>
              <Filter />
              Clear
            </Button>
          </div>
        </div>
      </div>

      {view === "log" ? (
        <Panel
          title="Decision log"
          icon={<ActivityIcon />}
          subtitle={
            filtered
              ? `${filteredActivity.length} of ${activity.length} events match the filters`
              : "Newest first · refreshed every 25 seconds"
          }
          flush
        >
          {filteredActivity.length ? (
            <div className="timeline" style={{ maxHeight: 680, overflowY: "auto" }}>
              {filteredActivity.map((item) => (
                <div className="tl-item" key={item.id}>
                  <span className={`tl-dot ${item.level}`} />
                  <div className="tl-body">
                    <div className="tl-msg">{item.message}</div>
                    <div className="tl-meta">
                      <span className="cat">{item.category}</span>
                      <span>{item.level}</span>
                      <span title={fmtDate(item.createdAt)}>{timeAgo(item.createdAt)}</span>
                    </div>
                  </div>
                  <span className="dimtx nowrap" style={{ fontSize: 12.5 }}>
                    {fmtDate(item.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ActivityIcon />}
              title={activity.length ? "No events match" : "Nothing has happened yet"}
              message={
                activity.length
                  ? "Clear the filters or widen the level selection."
                  : "Bot decisions, manual entries and risk events will appear here as soon as the desk acts."
              }
              action={
                activity.length ? (
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/scanner" className="btn btn-primary btn-sm">
                    <Radar />
                    Scan pools
                  </Link>
                )
              }
            />
          )}
        </Panel>
      ) : (
        <Panel
          title="Transaction history"
          icon={<ArrowUpRight />}
          subtitle="Paper fills are simulated; confirmed rows link to Solscan."
          flush
        >
          {filteredTransactions.length ? (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Mode</th>
                    <th className="hide-sm">Pool</th>
                    <th>Amount</th>
                    <th className="hide-sm">Fee</th>
                    <th>Status</th>
                    <th className="hide-sm">Signature</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((item) => (
                    <tr key={item.id}>
                      <td className="dimtx nowrap" title={fmtDate(item.createdAt)}>
                        {timeAgo(item.createdAt)}
                      </td>
                      <td>
                        <span className="cell-main" style={{ textTransform: "capitalize" }}>
                          {item.type.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td>
                        <Badge tone={item.mode === "live" ? "amber" : "neutral"}>{item.mode}</Badge>
                      </td>
                      <td className="hide-sm">{item.poolName ?? "—"}</td>
                      <td className="mono">{fmtUsd(item.amountUsd)}</td>
                      <td className="hide-sm mono dim">
                        {fmtUsd(item.feeUsd)}
                        {item.networkFeeUsd > 0 ? (
                          <div className="cell-sub">{fmtUsd(item.networkFeeUsd)} network</div>
                        ) : null}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[item.status]} dot>
                          {item.status}
                        </Badge>
                      </td>
                      <td className="hide-sm">
                        {item.signature ? (
                          <a
                            className="row gap4 mono"
                            href={explorerTx(item.signature)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontSize: 13, color: "var(--accent)" }}
                          >
                            {item.signature.slice(0, 6)}…{item.signature.slice(-4)}
                            <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="dimtx">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={<ArrowUpRight />}
              title={transactions.length ? "No transactions match" : "No transactions yet"}
              message={
                transactions.length
                  ? "Clear the search to see the full ledger."
                  : "Every simulated fill and signed transaction will be recorded here."
              }
              action={
                transactions.length ? (
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/scanner" className="btn btn-primary btn-sm">
                    <Radar />
                    Open a position
                  </Link>
                )
              }
            />
          )}
        </Panel>
      )}

      <div className="hint mt16">
        The log is written server-side by the engine. Secrets and private keys are redacted before
        anything is persisted or sent to Telegram.
      </div>
    </div>
  );
}
