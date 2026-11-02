"use client";

import type { PoolSnapshot, StrategyName, StrategyChoice } from "@/lib/types";
import { Badge, type Tone } from "../ui";

function hueOf(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 360;
  }
  return hash;
}

export function TokenIcon({ symbol, index = 0 }: { symbol: string; index?: number }) {
  const hue = (hueOf(symbol || "?") + index * 58) % 360;
  return (
    <span
      className="token-ic"
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 72% 66%), hsl(${(hue + 52) % 360} 76% 56%))`,
      }}
      title={symbol}
    >
      {(symbol || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function PoolPair({ pool, size = "md" }: { pool: PoolSnapshot; size?: "md" | "lg" }) {
  return (
    <span className="token-pair" style={size === "lg" ? { transform: "scale(1.12)", transformOrigin: "left" } : undefined}>
      <TokenIcon symbol={pool.tokenX.symbol} />
      <TokenIcon symbol={pool.tokenY.symbol} index={1} />
    </span>
  );
}

export function protocolLabel(protocol: "dlmm" | "damm-v2"): string {
  return protocol === "dlmm" ? "DLMM" : "DAMM v2";
}

export function ProtocolBadge({ protocol }: { protocol: "dlmm" | "damm-v2" }) {
  return (
    <Badge tone={protocol === "dlmm" ? "cyan" : "violet"}>{protocolLabel(protocol)}</Badge>
  );
}

const STRATEGY_TONE: Record<StrategyName, Tone> = {
  Spot: "cyan",
  Curve: "accent",
  BidAsk: "amber",
};

export function StrategyBadge({ strategy }: { strategy: StrategyName }) {
  return <Badge tone={STRATEGY_TONE[strategy]}>{strategy}</Badge>;
}

export function strategyLabel(choice: StrategyChoice): string {
  if (choice === "auto") return "Engine auto";
  if (choice === "spot") return "Spot";
  if (choice === "curve") return "Curve";
  return "BidAsk";
}

export function RiskBadge({ score, flags }: { score: number; flags?: number }) {
  const tone: Tone = score >= 65 ? "red" : score >= 40 ? "amber" : "green";
  return (
    <Badge tone={tone} title={`Risk score ${score}/100`}>
      Risk {score}
      {flags ? ` · ${flags}` : ""}
    </Badge>
  );
}
