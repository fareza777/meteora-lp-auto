"use client";

import {
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { useToast } from "./toast";

/* --------------------------------------------------------------------------
   Button
   -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "amber";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizeClass = size === "md" ? "" : size === "icon" ? "btn-icon" : `btn-${size}`;
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${sizeClass} ${className}`.trim()}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="spinner" style={{ width: 13, height: 13 }} aria-hidden />
      ) : null}
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------------
   Panel
   -------------------------------------------------------------------------- */

export function Panel({
  title,
  icon,
  subtitle,
  action,
  children,
  className = "",
  bodyClass = "",
  flush = false,
  noHead = false,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClass?: string;
  flush?: boolean;
  noHead?: boolean;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {!noHead && (title || action) ? (
        <header className="panel-head">
          <div className="panel-head-main">
            <div className="panel-title">
              {icon}
              {title}
            </div>
            {subtitle ? <div className="panel-sub">{subtitle}</div> : null}
          </div>
          {action ? <div className="panel-actions">{action}</div> : null}
        </header>
      ) : null}
      {flush ? children : <div className={`panel-body ${bodyClass}`.trim()}>{children}</div>}
    </section>
  );
}

/* --------------------------------------------------------------------------
   Badges & rings
   -------------------------------------------------------------------------- */

export type Tone = "neutral" | "accent" | "green" | "red" | "amber" | "cyan" | "violet";

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {dot ? <span className={`dot ${tone === "neutral" ? "" : tone}`} /> : null}
      {children}
    </span>
  );
}

export function ScoreRing({
  value,
  kind = "score",
  size = 34,
  label,
}: {
  value: number;
  kind?: "score" | "risk";
  size?: number;
  label?: string;
}) {
  const rounded = Math.round(Math.max(0, Math.min(100, value)));
  const riskClass =
    kind === "risk" ? `risk ${rounded >= 65 ? "high" : rounded < 40 ? "low" : ""}` : "";
  return (
    <div
      className={`score-ring ${riskClass}`}
      style={{ "--p": rounded, "--sz": `${size}px` } as React.CSSProperties}
      title={label ?? `${rounded}/100`}
      aria-label={label ?? `${rounded} out of 100`}
    >
      <span>{rounded}</span>
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  icon,
  hero = false,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  hero?: boolean;
  tone?: "up" | "down" | "";
}) {
  return (
    <div className={`stat ${hero ? "hero" : ""}`}>
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Segmented
   -------------------------------------------------------------------------- */

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  accent = false,
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  accent?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className={`seg ${size === "sm" ? "sm" : ""}`} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={option.value === value}
          className={`seg-item ${option.value === value ? `active ${accent ? "accent" : ""}` : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
          {typeof option.count === "number" ? <span className="dim">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Form primitives
   -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  className = "",
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`.trim()}>
      {label ? (
        <span className="label">
          <span>{label}</span>
          {optional ? <span className="opt">{optional}</span> : null}
        </span>
      ) : null}
      {children}
      {error ? <span className="hint error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  sub,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="toggle" style={disabled ? { opacity: 0.55, pointerEvents: "none" } : undefined}>
      <span>
        <span className="tg-label">{label}</span>
        {sub ? <span className="tg-sub" style={{ display: "block" }}>{sub}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}

/* --------------------------------------------------------------------------
   Overlay / Modal / Drawer
   -------------------------------------------------------------------------- */

function useOverlay(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
}

function OverlayPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <OverlayPortal>
      <div
        className="overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className={`modal ${size === "md" ? "" : size}`} role="dialog" aria-modal="true">
          <div className="modal-head">
            <div className="row-top">
              {icon ? <span className="avatar">{icon}</span> : null}
              <div>
                <div className="modal-title">{title}</div>
                {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
              </div>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </div>
      </div>
    </OverlayPortal>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  useOverlay(open, onClose);
  if (!open) return null;
  return (
    <OverlayPortal>
      <div className="drawer-overlay" onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}>
        <aside className={`drawer ${size === "lg" ? "lg" : ""}`} role="dialog" aria-modal="true">
          <div className="drawer-head">
            <div className="row-top">
              {icon ? <span className="avatar">{icon}</span> : null}
              <div>
                <div className="modal-title">{title}</div>
                {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
              </div>
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X />
            </button>
          </div>
          <div className="drawer-body">{children}</div>
          {footer ? <div className="drawer-foot">{footer}</div> : null}
        </aside>
      </div>
    </OverlayPortal>
  );
}

/* --------------------------------------------------------------------------
   Empty / Skeleton / copy
   -------------------------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon ? <div className="empty-ic">{icon}</div> : null}
      <h4>{title}</h4>
      {message ? <p>{message}</p> : null}
      {action ? <div className="mt8">{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  width = "100%",
  height = 14,
  radius = 7,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={`skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Clipboard unavailable");
    }
  }, [value, toast]);

  return (
    <button type="button" className="copy-chip" onClick={copy} title={`Copy ${value}`}>
      <span className="truncate">{label ?? value}</span>
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

/* --------------------------------------------------------------------------
   Sparkline
   -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  tone = "accent",
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "red" | "cyan";
}) {
  if (!values.length) return <span className="dim">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const color = tone === "red" ? "var(--red)" : tone === "cyan" ? "var(--cyan)" : "var(--accent)";
  const id = `spark-${tone}-${values.length}-${Math.round(min * 100)}-${Math.round(max * 100)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points.join(" ")} ${width},${height}`}
        fill={`url(#${id})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* --------------------------------------------------------------------------
   Count-up number (subtle, respects reduced motion)
   -------------------------------------------------------------------------- */

export function AnimatedNumber({ value, format }: { value: number; format: (value: number) => string }) {
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = display;
    const delta = value - start;
    if (Math.abs(delta) < 0.01) {
      setDisplay(value);
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / 480);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(start + delta * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format(display)}</>;
}

/* --------------------------------------------------------------------------
   Simple tooltip-ish info label
   -------------------------------------------------------------------------- */

export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <span className="dim" title={typeof children === "string" ? children : undefined}>
      {children}
    </span>
  );
}
