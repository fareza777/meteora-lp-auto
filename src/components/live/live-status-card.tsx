"use client";

import Link from "next/link";
import { ArrowRight, CircleCheck, LockKeyhole, Power, ShieldCheck, TriangleAlert } from "lucide-react";
import type { LiveReadiness, WalletSnapshot } from "@/lib/types";
import { fmtCountdown, fmtUsd } from "@/lib/client/format";
import { apiPost } from "@/lib/client/api";
import { useRefreshAll } from "@/lib/client/hooks";
import { Badge, Button, Panel } from "../ui";
import { useToast } from "../toast";

export function LiveStatusCard({
  readiness,
  wallet,
}: {
  readiness: LiveReadiness;
  wallet?: WalletSnapshot | null;
}) {
  const toast = useToast();
  const refresh = useRefreshAll();

  async function halt() {
    try {
      await apiPost("/api/live/kill");
      toast.success("Kill switch engaged", "All bots paused and live trading disarmed.");
      await refresh();
    } catch {
      toast.error("Could not engage the kill switch", "Try again from Settings.");
    }
  }

  const gates = [
    { label: "Server", done: readiness.globallyEnabled },
    { label: "RPC", done: readiness.rpcReady },
    { label: "Wallet", done: Boolean(readiness.wallet) },
    { label: "Armed", done: readiness.armed },
  ];

  const status = readiness.killSwitch
    ? { tone: "red" as const, label: "Halted" }
    : readiness.canTrade
      ? { tone: "green" as const, label: "Live ready" }
      : { tone: "amber" as const, label: "Paper only" };

  return (
    <Panel
      title="Live execution"
      icon={<ShieldCheck />}
      subtitle={
        readiness.killSwitch
          ? "Kill switch engaged. Nothing executes."
          : readiness.canTrade
            ? `Armed · ${fmtCountdown(readiness.armedUntil)} remaining`
            : "Real capital stays locked until every gate is green."
      }
      action={<Badge tone={status.tone} dot>{status.label}</Badge>}
    >
      <div className="row between" style={{ gap: 6 }}>
        {gates.map((gate) => (
          <span
            key={gate.label}
            className="row gap4"
            style={{ fontSize: 12.5, color: gate.done ? "var(--text-2)" : "var(--text-3)" }}
            title={`${gate.label}: ${gate.done ? "ready" : "not ready"}`}
          >
            {gate.done ? (
              <CircleCheck size={11} style={{ color: "var(--accent)" }} />
            ) : (
              <LockKeyhole size={11} />
            )}
            {gate.label}
          </span>
        ))}
      </div>

      {readiness.wallet && wallet ? (
        <div className="range-viz mt12" style={{ padding: "10px 11px" }}>
          <div className="row between">
            <span className="dimtx">Execution wallet</span>
            <span className="mono" style={{ fontSize: 13 }}>{fmtUsd(wallet.totalValueUsd)}</span>
          </div>
          <div className="row between" style={{ marginTop: 4 }}>
            <span className="dimtx">{wallet.solBalance.toFixed(3)} SOL</span>
            <span className="dimtx">{wallet.tokens.length} tokens</span>
          </div>
        </div>
      ) : null}

      {!readiness.canTrade && readiness.reason ? (
        <div className={`notice ${readiness.killSwitch ? "danger" : "warn"} mt12`}>
          <TriangleAlert />
          <span>{readiness.reason}</span>
        </div>
      ) : null}

      <div className="row gap6 mt16 wrap">
        <Link href="/settings" className="btn btn-secondary btn-sm">
          Manage live
          <ArrowRight />
        </Link>
        {!readiness.killSwitch ? (
          <Button variant="danger" size="sm" onClick={halt}>
            <Power />
            Halt all
          </Button>
        ) : (
          <Link href="/settings" className="btn btn-outline btn-sm">
            Resume controls
          </Link>
        )}
      </div>
    </Panel>
  );
}
