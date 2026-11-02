"use client";

import type { PoolAnalysis } from "@/lib/types";
import { fmtCompact, fmtPct } from "@/lib/client/format";
import { Badge } from "../ui";
import { PoolPair, RiskBadge, StrategyBadge, protocolLabel } from "./pool-visuals";

export function PoolCard({
  analysis,
  onOpen,
  compact = false,
}: {
  analysis: PoolAnalysis;
  onOpen: (analysis: PoolAnalysis) => void;
  compact?: boolean;
}) {
  const { pool } = analysis;
  return (
    <button type="button" className="pool-card" onClick={() => onOpen(analysis)} style={{ textAlign: "left" }}>
      <div className="pc-head">
        <div className="row-top" style={{ gap: 10, minWidth: 0 }}>
          <PoolPair pool={pool} />
          <div style={{ minWidth: 0 }}>
            <div className="pool-name truncate">
              {pool.tokenX.symbol}
              <span className="dim" style={{ fontWeight: 400 }}>
                /
              </span>
              {pool.tokenY.symbol}
            </div>
            <div className="pool-meta">
              <span>{protocolLabel(pool.protocol)}</span>
              <span className="sepd" />
              <span>{pool.binStep} bp bin</span>
              <span className="sepd" />
              <span>{fmtCompact(pool.tvlUsd)} TVL</span>
            </div>
          </div>
        </div>
        <div className="score">
          <div style={{ textAlign: "right" }}>
            <div className="mono" style={{ fontSize: 17, letterSpacing: "-0.02em" }}>
              {fmtPct(analysis.feeAprPct, { digits: 0 })}
            </div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              fee APR
            </div>
          </div>
          <div className="score-ring" style={{ "--p": Math.round(analysis.score) } as React.CSSProperties}>
            <span>{Math.round(analysis.score)}</span>
          </div>
        </div>
      </div>

      {!compact ? (
        <div className="pool-metrics four">
          <div className="pm">
            <div className="pm-label">24h fees</div>
            <div className="pm-value up">{fmtCompact(pool.fees24hUsd)}</div>
          </div>
          <div className="pm">
            <div className="pm-label">24h volume</div>
            <div className="pm-value">{fmtCompact(pool.volume24hUsd)}</div>
          </div>
          <div className="pm">
            <div className="pm-label">Volatility</div>
            <div className="pm-value">{fmtPct(analysis.volatilityPct, { digits: 1 })}</div>
          </div>
          <div className="pm">
            <div className="pm-label">Net APR</div>
            <div className={`pm-value ${analysis.netAprPct > 0 ? "up" : ""}`}>
              {fmtPct(analysis.netAprPct, { digits: 0 })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="row wrap between" style={{ gap: 8 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <StrategyBadge strategy={analysis.recommendedStrategy} />
          <Badge
            tone={
              analysis.signals.consistency >= 65
                ? "green"
                : analysis.signals.consistency >= 40
                  ? "amber"
                  : "red"
            }
            title="How evenly fee production held up across the 1h, 4h and 24h windows"
          >
            Consistency {Math.round(analysis.signals.consistency)}
          </Badge>
          {pool.hasFarm ? <span className="badge tone-accent">Farm</span> : null}
        </div>
        <RiskBadge score={analysis.riskScore} flags={analysis.riskFlags.filter((flag) => flag.severity !== "info").length} />
      </div>
    </button>
  );
}
