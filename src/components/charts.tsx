"use client";

import { useEffect, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EquityPoint } from "@/lib/types";
import { fmtCompact, fmtDate, fmtUsd } from "@/lib/client/format";

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const axisStyle = {
  fill: "var(--text-3)",
  fontSize: 12.5,
  fontFamily: "var(--font-mono)",
} as const;

const tooltipStyle = {
  background: "var(--glass-2)",
  border: "1px solid var(--line-2)",
  borderRadius: 10,
  boxShadow: "var(--shadow-soft)",
  padding: "10px 12px",
  fontSize: 12.5,
} as const;

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const rough = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized < 1.5 ? 1 : normalized < 2.5 ? 2 : normalized < 3.5 ? 2.5 : normalized < 7 ? 5 : 10) *
    magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= max + step * 1e-9; tick += step) {
    ticks.push(Number(tick.toPrecision(12)));
  }
  return ticks;
}

interface TooltipEntry {
  value?: number | string;
  dataKey?: string | number;
  name?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

interface TooltipInjected {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
}

function EquityTooltip({ active, payload, label }: TooltipInjected) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as EquityPoint | undefined;
  if (!point) return null;
  const pnl = point.pnl ?? 0;
  return (
    <div style={tooltipStyle}>
      <div style={{ color: "var(--text-3)", fontSize: 12.5, marginBottom: 5 }}>
        {label ? fmtDate(Number(label)) : ""}
      </div>
      <div className="row between" style={{ gap: 18 }}>
        <span style={{ color: "var(--text-2)" }}>Equity</span>
        <span className="mono" style={{ color: "var(--text)" }}>
          {fmtUsd(point.equity)}
        </span>
      </div>
      <div className="row between" style={{ gap: 18, marginTop: 3 }}>
        <span style={{ color: "var(--text-2)" }}>P&amp;L</span>
        <span className="mono" style={{ color: pnl >= 0 ? "var(--green)" : "var(--red)" }}>
          {fmtUsd(pnl, { sign: true })}
        </span>
      </div>
      <div className="row between" style={{ gap: 18, marginTop: 3 }}>
        <span style={{ color: "var(--text-2)" }}>Fees</span>
        <span className="mono" style={{ color: "var(--text-2)" }}>
          {fmtUsd(point.fees)}
        </span>
      </div>
    </div>
  );
}

export function EquityChart({
  points,
  initialCapital,
  height = 268,
}: {
  points: EquityPoint[];
  initialCapital: number;
  height?: number;
}) {
  const mounted = useMounted();
  if (!mounted) return <div style={{ height }} />;
  if (points.length < 2) {
    return (
      <div className="empty" style={{ height }}>
        <p>Your equity curve will appear here as the portfolio marks and trades.</p>
      </div>
    );
  }
  const last = points[points.length - 1];
  const positive = last.equity >= initialCapital;
  const stroke = positive ? "var(--accent)" : "var(--red)";
  const values = points.map((point) => point.equity);
  const floor = Math.min(...values, initialCapital);
  const ceiling = Math.max(...values, initialCapital);
  const padding = Math.max((ceiling - floor) * 0.12, ceiling * 0.004, 1);
  const narrow = ceiling - floor < 2_000;
  const intraday = points[points.length - 1].ts - points[0].ts <= 2 * 86_400_000;
  const yTicks = niceTicks(floor - padding, ceiling + padding);
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="70%" stopColor={stroke} stopOpacity={0.04} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="2 4" />
          <XAxis
            dataKey="ts"
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            minTickGap={44}
            tickFormatter={(value: number) =>
              intraday
                ? new Date(value).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
                : new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            }
          />
          <YAxis
            tick={axisStyle}
            tickLine={false}
            axisLine={false}
            width={64}
            domain={[floor - padding, ceiling + padding]}
            ticks={yTicks}
            allowDataOverflow
            tickFormatter={(value: number) => (narrow ? fmtUsd(value, { whole: true }) : fmtCompact(value))}
          />
          <Tooltip content={<EquityTooltip />} cursor={{ stroke: "var(--line-3)", strokeDasharray: "3 3" }} />
          <ReferenceLine
            y={initialCapital}
            stroke="var(--line-3)"
            strokeDasharray="4 4"
            label={{
              value: "start",
              position: "insideTopRight",
              fill: "var(--text-3)",
              fontSize: 12.5,
            }}
          />
          <Area
            type="monotone"
            dataKey="equity"
            stroke={stroke}
            strokeWidth={1.8}
            fill="url(#equity-fill)"
            baseValue="dataMin"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, fill: stroke, stroke: "var(--surface-2)", strokeWidth: 2 }}
          />
          <ReferenceDot
            x={last.ts}
            y={last.equity}
            r={3.5}
            fill={stroke}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

