"use client";

import { clamp, fmtPrice } from "@/lib/client/format";

export function PriceRangeBar({
  lower,
  upper,
  current,
  inRange = true,
  compact = false,
}: {
  lower: number;
  upper: number;
  current: number;
  inRange?: boolean;
  compact?: boolean;
}) {
  const span = upper - lower;
  const raw = span > 0 ? ((current - lower) / span) * 100 : 50;
  const position = clamp(raw, 0, 100);
  const distance = span > 0 ? ((current - lower) / span) * 100 : 0;
  return (
    <div className={`range-viz ${inRange ? "" : "out"}`} style={compact ? { padding: "10px 11px 9px" } : undefined}>
      <div className="range-labels">
        <span>
          L <strong>{fmtPrice(lower)}</strong>
        </span>
        <span className="row gap4" style={{ color: inRange ? "var(--text-2)" : "var(--amber)" }}>
          <span className={`dot ${inRange ? "green" : "amber"}`} />
          {fmtPrice(current)}
        </span>
        <span>
          H <strong>{fmtPrice(upper)}</strong>
        </span>
      </div>
      <div className="range-track">
        <div className="range-fill" style={{ left: "0%", width: "100%" }} />
        <div className="range-pin" style={{ left: `${position}%` }} />
      </div>
      {!compact ? (
        <div className="row between mt8" style={{ fontSize: 12.5, color: "var(--text-3)" }}>
          <span>{inRange ? "Price inside range" : "Price outside range"}</span>
          <span className="mono">
            {distance >= 0 ? "+" : ""}
            {distance.toFixed(1)}% of range
          </span>
        </div>
      ) : null}
    </div>
  );
}
