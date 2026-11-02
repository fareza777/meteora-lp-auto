const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const numberFour = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export function fmtUsd(value: number | null | undefined, opts?: { whole?: boolean; sign?: boolean }): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const formatted = abs >= 1000 ? usdWhole.format(abs) : usd.format(abs);
  const signed = opts?.sign && value !== 0 ? (value > 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${signed}${formatted}`;
}

export function fmtCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000_000) return `${sign}$${number.format(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${number.format(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${numberWhole(abs / 1000)}K`;
  if (abs >= 1_000) return `${sign}$${number.format(abs / 1000)}K`;
  if (abs >= 1) return `${sign}$${number.format(abs)}`;
  return `${sign}$${numberFour.format(abs)}`;
}

function numberWhole(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function fmtPct(
  value: number | null | undefined,
  opts?: { sign?: boolean; digits?: number; suffix?: boolean },
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const digits = opts?.digits ?? 2;
  const sign = opts?.sign && value !== 0 ? (value > 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}${opts?.suffix === false ? "" : "%"}`;
}

export function fmtNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000) return number.format(value);
  if (abs >= 1) return numberFour.format(value);
  if (abs >= 0.01) return value.toFixed(5);
  if (abs >= 0.000001) return value.toFixed(7);
  return value.toExponential(3);
}

export function fmtTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}K`;
  if (value >= 100) return value.toFixed(1);
  if (value >= 1) return value.toFixed(3);
  return value.toPrecision(3);
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return "—";
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

export function fmtDate(ts: number | null | undefined, withTime = true): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!withTime) return date;
  return `${date}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return fmtDate(ts, false);
}

export function fmtCountdown(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = ts - Date.now();
  if (diff <= 0) return "expired";
  const min = Math.floor(diff / 60_000);
  const hr = Math.floor(min / 60);
  if (hr >= 1) return `${hr}h ${min % 60}m`;
  return `${min}m`;
}

export function pctOf(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function riskTone(score: number): "green" | "amber" | "red" {
  if (score < 40) return "green";
  if (score < 65) return "amber";
  return "red";
}

export function pnlClass(value: number | null | undefined): string {
  if (!value) return "";
  return value > 0 ? "up" : "down";
}

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
