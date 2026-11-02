"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Coins,
  ExternalLink,
  TriangleAlert,
} from "lucide-react";
import type { PositionView } from "@/lib/types";
import { fmtDate, fmtPct, fmtTokenAmount, fmtUsd, timeAgo } from "@/lib/client/format";
import { apiPost, errorMessage } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/wallet";
import { Badge, Button, Modal } from "../ui";
import { useToast } from "../toast";
import { TokenIcon, ProtocolBadge, StrategyBadge } from "../market/pool-visuals";
import { PriceRangeBar } from "../market/price-range";

export function PositionCard({
  position,
  showMode = false,
  onChanged,
}: {
  position: PositionView;
  showMode?: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [claiming, setClaiming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isOpen = position.status === "open";
  const pnl = position.pnlUsd;
  const value = position.valueUsd ?? position.currentValueUsd;
  const unclaimed = position.unclaimedFeesUsd;
  const canClaim = isOpen && unclaimed >= 0.01;

  async function claim() {
    setClaiming(true);
    try {
      await apiPost(`/api/positions/${position.id}/claim`);
      toast.success("Fees claimed", `${fmtUsd(unclaimed)} moved to cash.`);
      onChanged();
    } catch (caught) {
      toast.fromError("Claim failed", caught);
    } finally {
      setClaiming(false);
    }
  }

  async function close() {
    setClosing(true);
    try {
      await apiPost(`/api/positions/${position.id}/close`, { reason: "Manual exit" });
      toast.success("Position closed", `${position.poolName} · ${fmtUsd(pnl, { sign: true })} realised.`);
      setConfirmOpen(false);
      onChanged();
    } catch (caught) {
      toast.error("Close failed", errorMessage(caught));
    } finally {
      setClosing(false);
    }
  }

  return (
    <article className="panel interactive">
      <div className="panel-body" style={{ padding: 15 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div className="row-top" style={{ gap: 9, minWidth: 0 }}>
            <div className="token-pair">
              <TokenIcon symbol={position.tokenXSymbol} />
              <TokenIcon symbol={position.tokenYSymbol} index={1} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="pool-name truncate" style={{ fontSize: 15 }}>
                {position.tokenXSymbol}/{position.tokenYSymbol}
              </div>
              <div className="pool-meta">
                {showMode ? (
                  <Badge tone={position.mode === "live" ? "amber" : "neutral"}>{position.mode}</Badge>
                ) : null}
                <ProtocolBadge protocol={position.protocol} />
                <span className="sepd" />
                <span>{position.strategy}</span>
              </div>
              <div className="pos-address" title={position.poolAddress}>
                Pool {position.poolAddress.slice(0, 4)}…{position.poolAddress.slice(-4)}
              </div>
            </div>
          </div>
          {isOpen ? (
            <Badge tone={position.inRange ? "green" : "amber"} dot>
              {position.inRange ? "In range" : "Out of range"}
            </Badge>
          ) : (
            <Badge tone="neutral">Closed</Badge>
          )}
        </div>

        <div className="pos-stats mt16">
          <div>
            <div className="pm-label">Capital</div>
            <div className="pm-value" style={{ fontSize: 14 }}>{fmtUsd(position.capitalUsd)}</div>
          </div>
          <div>
            <div className="pm-label">{isOpen ? "Value" : "Proceeds"}</div>
            <div className="pm-value" style={{ fontSize: 14 }}>
              {fmtUsd(isOpen ? value : position.closeProceedsUsd ?? value)}
            </div>
          </div>
          <div>
            <div className="pm-label">P&amp;L</div>
            <div className={`pm-value ${pnl > 0 ? "up" : pnl < 0 ? "down" : ""}`} style={{ fontSize: 14 }}>
              {fmtUsd(pnl, { sign: true })}
              <span className="dimtx" style={{ marginLeft: 4 }}>
                {fmtPct(position.pnlPct, { sign: true, digits: 1 })}
              </span>
            </div>
          </div>
        </div>

        {isOpen ? (
          <div className="mt12">
            <PriceRangeBar
              lower={position.lowerPrice}
              upper={position.upperPrice}
              current={position.currentPrice}
              inRange={position.inRange}
              compact
            />
          </div>
        ) : null}

        <div className="row between wrap mt12" style={{ gap: 8 }}>
          <div className="row gap12" style={{ fontSize: 13, color: "var(--text-3)" }}>
            <span>
              Fees{" "}
              <strong className="mono" style={{ color: "var(--green)", fontWeight: 500 }}>
                {fmtUsd(isOpen ? unclaimed : position.claimedFeesUsd)}
                {isOpen && position.claimedFeesUsd > 0 ? (
                  <span className="dim"> +{fmtUsd(position.claimedFeesUsd)} claimed</span>
                ) : null}
              </strong>
            </span>
            <span title="Liquidity value versus holding the entry basket">
              IL vs hold{" "}
              <strong className={`mono ${position.ilUsd > 0 ? "up" : position.ilUsd < 0 ? "down" : ""}`} style={{ fontWeight: 500 }}>
                {fmtUsd(position.ilUsd, { sign: true })}
              </strong>
            </span>
          </div>
          <div className="row gap6">
            {position.txOpen ? (
              <a
                className="icon-btn"
                href={explorerTx(position.txOpen)}
                target="_blank"
                rel="noopener noreferrer"
                title="Open transaction"
                aria-label="Open transaction on Solscan"
              >
                <ExternalLink />
              </a>
            ) : null}
            {isOpen ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={claim}
                  loading={claiming}
                  disabled={!canClaim}
                  title={canClaim ? "Claim accrued fees" : "No claimable fees yet"}
                >
                  <Coins />
                  Claim
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
                  Close
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="row between mt12" style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          <span>
            {isOpen
              ? `Opened ${timeAgo(position.openedAt)} · ${position.strategy}`
              : `${position.closeReason ?? "Closed"} · ${fmtDate(position.closedAt)}`}
          </span>
          <span className="mono">
            {position.tokenXSymbol} {fmtTokenAmount(position.currentXAmount)} ·{" "}
            {position.tokenYSymbol} {fmtTokenAmount(position.currentYAmount)}
          </span>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Close ${position.tokenXSymbol}/${position.tokenYSymbol}`}
        subtitle={
          position.mode === "live"
            ? "This submits a real on-chain transaction that removes liquidity and returns funds to the execution wallet."
            : "This closes the simulated position at the current mark."
        }
        icon={<ArrowUpRight />}
        size="sm"
        footer={
          <div className="row between w-full">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={closing}>
              Keep open
            </Button>
            <Button variant="danger" onClick={close} loading={closing}>
              {position.mode === "live" ? "Close position" : "Close position"}
            </Button>
          </div>
        }
      >
        <div className="col gap6">
          <div className="kv">
            <span className="k">Capital</span>
            <span className="v">{fmtUsd(position.capitalUsd)}</span>
          </div>
          <div className="kv">
            <span className="k">Current value</span>
            <span className="v">{fmtUsd(value)}</span>
          </div>
          <div className="kv">
            <span className="k">Unrealised P&amp;L</span>
            <span className={`v ${pnl >= 0 ? "up" : "down"}`}>{fmtUsd(pnl, { sign: true })}</span>
          </div>
          <div className="kv">
            <span className="k">Unclaimed fees</span>
            <span className="v">{fmtUsd(unclaimed)}</span>
          </div>
        </div>
        {!position.inRange ? (
          <div className="notice warn mt12">
            <TriangleAlert />
            <span>This position is out of range. Closing now realises the current mark.</span>
          </div>
        ) : null}
      </Modal>
    </article>
  );
}
