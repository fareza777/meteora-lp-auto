"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw } from "lucide-react";
import type { OhlcvCandle } from "@/lib/types";
import { fmtCompact, fmtDate, fmtPct, fmtPrice } from "@/lib/client/format";
import { emaSeries, smaSeries, swingLevels } from "@/lib/analytics/technical";

const PAD = { top: 10, right: 66, bottom: 24, left: 6 };
const VOLUME_HEIGHT = 44;
const VOLUME_GAP = 12;
const MIN_VISIBLE = 12;
const MAX_BODY_WIDTH = 18;
const TIP_WIDTH = 208;
const TIP_HEIGHT = 194;
const UP = "var(--green)";
const DOWN = "var(--red)";
const SMA_COLOR = "var(--cyan)";
const EMA_COLOR = "var(--amber)";

type ViewWindow = { start: number; end: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function priceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const rough = span / Math.max(1, count);
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

function shortPrice(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  return Math.abs(value) < 0.01 ? value.toExponential(1) : fmtPrice(value);
}

function linePath(
  series: (number | null)[],
  x: (index: number) => number,
  y: (price: number) => number,
): string {
  let path = "";
  let open = false;
  series.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      open = false;
      return;
    }
    path += `${open ? "L" : "M"}${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
    open = true;
  });
  return path;
}

function lastDefined(series: (number | null)[]): number | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index];
    if (value !== null) return value;
  }
  return null;
}

export function CandleChart({
  candles,
  lowerPrice,
  upperPrice,
  height = 300,
}: {
  candles: OhlcvCandle[];
  lowerPrice?: number;
  upperPrice?: number;
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const panRef = useRef<{
    x: number;
    viewStart: number;
    span: number;
    fullSpan: number;
    plotWidth: number;
    moved: boolean;
  } | null>(null);
  const pinchRef = useRef<{
    dist: number;
    span: number;
    fullSpan: number;
    minSpan: number;
    plotLeft: number;
    plotWidth: number;
    anchor: number;
  } | null>(null);
  const liveRef = useRef<{
    start: number;
    span: number;
    fullSpan: number;
    minSpan: number;
    plotLeft: number;
    plotWidth: number;
    zoomed: boolean;
  } | null>(null);

  const [width, setWidth] = useState(0);
  const [showSma, setShowSma] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [view, setView] = useState<ViewWindow | null>(null);
  const [dragging, setDragging] = useState(false);
  const clipId = `candle-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const measure = () => setWidth(Math.floor(element.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHoverIndex(null);
    setView(null);
    pointersRef.current.clear();
    panRef.current = null;
    pinchRef.current = null;
    setDragging(false);
  }, [candles]);

  const viewState = useMemo(() => {
    const n = candles.length;
    const fullSpan = Math.max(1, n - 1);
    const minSpan = Math.min(fullSpan, Math.max(1, MIN_VISIBLE - 1));
    if (!view) return { start: 0, end: fullSpan, span: fullSpan, fullSpan, minSpan, zoom: 1 };
    const span = clamp(view.end - view.start, minSpan, fullSpan);
    const start = clamp(view.start, 0, fullSpan - span);
    return { start, end: start + span, span, fullSpan, minSpan, zoom: (fullSpan + 1) / (span + 1) };
  }, [candles.length, view]);

  const geometry = useMemo(() => {
    if (width <= 0 || candles.length < 2) return null;
    const { start, end, span, fullSpan, minSpan, zoom } = viewState;
    const from = Math.max(0, Math.floor(start));
    const to = Math.min(candles.length - 1, Math.ceil(end));
    const visible = candles.slice(from, to + 1);
    const closes = candles.map((candle) => candle.close);
    let lo = Infinity;
    let hi = -Infinity;
    for (const candle of visible) {
      if (candle.low < lo) lo = candle.low;
      if (candle.high > hi) hi = candle.high;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const rawSpan = hi - lo || Math.max(Math.abs(hi) * 0.01, 1e-9);
    if (lowerPrice && upperPrice && lowerPrice > 0 && upperPrice > lowerPrice) {
      if (lowerPrice > lo - rawSpan * 0.5) lo = Math.min(lo, lowerPrice);
      if (upperPrice < hi + rawSpan * 0.5) hi = Math.max(hi, upperPrice);
    }
    const breathing = (hi - lo) * 0.07;
    lo -= breathing;
    hi += breathing;
    const priceTop = PAD.top;
    const priceHeight = Math.max(
      60,
      height - PAD.top - PAD.bottom - VOLUME_HEIGHT - VOLUME_GAP,
    );
    const volumeTop = priceTop + priceHeight + VOLUME_GAP;
    const plotLeft = PAD.left;
    const plotRight = Math.max(plotLeft + 40, width - PAD.right);
    const plotWidth = plotRight - plotLeft;
    const count = span + 1;
    const slot = plotWidth / count;
    const y = (price: number) => priceTop + ((hi - price) / (hi - lo)) * priceHeight;
    const x = (index: number) => plotLeft + ((index - start + 0.5) / count) * plotWidth;
    return {
      closes,
      visible,
      from,
      to,
      start,
      end,
      span,
      count,
      fullSpan,
      minSpan,
      zoom,
      lo,
      hi,
      priceTop,
      priceHeight,
      volumeTop,
      volumeBase: height - PAD.bottom,
      plotLeft,
      plotRight,
      plotWidth,
      bodyWidth: Math.max(1, Math.min(MAX_BODY_WIDTH, slot * 0.62)),
      y,
      x,
      ticks: priceTicks(lo, hi, 4),
    };
  }, [candles, viewState, width, height, lowerPrice, upperPrice]);

  const indicators = useMemo(() => {
    if (!geometry) return null;
    const sma20 = smaSeries(geometry.closes, 20);
    const ema50 = emaSeries(geometry.closes, 50);
    return {
      sma20,
      ema50,
      smaPath: showSma ? linePath(sma20, geometry.x, geometry.y) : "",
      emaPath: showEma ? linePath(ema50, geometry.x, geometry.y) : "",
      smaLast: lastDefined(sma20),
      emaLast: lastDefined(ema50),
    };
  }, [geometry, showSma, showEma]);

  const levels = useMemo(() => (candles.length ? swingLevels(candles) : null), [candles]);

  const hasGeometry = Boolean(geometry);

  useEffect(() => {
    liveRef.current = geometry
      ? {
          start: geometry.start,
          span: geometry.span,
          fullSpan: geometry.fullSpan,
          minSpan: geometry.minSpan,
          plotLeft: geometry.plotLeft,
          plotWidth: geometry.plotWidth,
          zoomed: geometry.zoom > 1.02,
        }
      : null;
  }, [geometry]);

  useEffect(() => {
    if (!hasGeometry) return;
    const element = svgRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      const live = liveRef.current;
      if (!live) return;
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      if (pointerX < live.plotLeft || pointerX > live.plotLeft + live.plotWidth) return;
      if (event.deltaY === 0) return;
      const delta =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * 120
            : event.deltaY;
      const factor = Math.exp(clamp(delta, -150, 150) * (event.ctrlKey ? 0.006 : 0.002));
      const currentSpan = live.span;
      const nextSpan = clamp(currentSpan * factor, live.minSpan, live.fullSpan);
      if (!live.zoomed && nextSpan >= currentSpan - 1e-6) return;
      event.preventDefault();
      if (nextSpan >= live.fullSpan - 1e-6) {
        setView(null);
        return;
      }
      const fraction = clamp((pointerX - live.plotLeft) / live.plotWidth, 0, 1);
      const anchor = live.start + fraction * currentSpan;
      const start = clamp(anchor - fraction * nextSpan, 0, live.fullSpan - nextSpan);
      setView({ start, end: start + nextSpan });
      setHoverIndex(Math.round(clamp(anchor, 0, candles.length - 1)));
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [hasGeometry, candles.length]);

  if (candles.length < 2) {
    return (
      <div className="empty" style={{ height }}>
        <p>Price history is not available for this pool right now.</p>
      </div>
    );
  }

  const zoomed = viewState.zoom > 1.02;
  const lastCandle = candles[candles.length - 1];
  const maxVolume = Math.max(
    1e-9,
    ...(geometry ? geometry.visible.map((candle) => candle.volume) : []),
  );
  const intraday = geometry
    ? candles[geometry.to].timestamp - candles[geometry.from].timestamp <= 48 * 3_600_000
    : false;

  const activeHover =
    hoverIndex !== null && geometry ? clamp(hoverIndex, geometry.from, geometry.to) : null;
  const hovered = activeHover !== null ? candles[activeHover] : null;
  const hoverChange =
    hovered && hovered.open > 0 ? ((hovered.close - hovered.open) / hovered.open) * 100 : 0;
  const hoverSma =
    showSma && indicators && activeHover !== null
      ? (indicators.sma20[activeHover] ?? null)
      : null;
  const hoverEma =
    showEma && indicators && activeHover !== null
      ? (indicators.ema50[activeHover] ?? null)
      : null;

  const timeLabel = (timestamp: number) =>
    intraday
      ? new Date(timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const timeMarks: { index: number; label: string; anchor: "start" | "middle" | "end" }[] = [];
  if (geometry) {
    const seenLabels = new Set<string>();
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      const index = clamp(
        Math.round(geometry.start + geometry.span * ratio),
        geometry.from,
        geometry.to,
      );
      const label = timeLabel(candles[index].timestamp);
      if (seenLabels.has(label)) continue;
      seenLabels.add(label);
      timeMarks.push({
        index,
        label,
        anchor: ratio === 0 ? "start" : ratio === 1 ? "end" : "middle",
      });
    }
  }

  const bandUpper = upperPrice && upperPrice > 0 ? upperPrice : null;
  const bandLower = lowerPrice && lowerPrice > 0 ? lowerPrice : null;
  const bandVisible =
    geometry !== null &&
    bandUpper !== null &&
    bandLower !== null &&
    bandUpper >= geometry.lo &&
    bandLower <= geometry.hi;
  const showLastPill = geometry !== null && geometry.to >= candles.length - 1;
  const lastPillY = geometry ? geometry.y(lastCandle.close) : 0;

  const hoverFromClientX = (clientX: number, element: SVGSVGElement): number | null => {
    if (!geometry) return null;
    const rect = element.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    if (pointerX < geometry.plotLeft || pointerX > geometry.plotLeft + geometry.plotWidth) {
      return null;
    }
    const raw =
      geometry.start +
      ((pointerX - geometry.plotLeft) / geometry.plotWidth) * geometry.count -
      0.5;
    return clamp(Math.round(raw), geometry.from, geometry.to);
  };

  const resetView = () => {
    setView(null);
    setHoverIndex(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const element = event.currentTarget;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // pointer can vanish between the browser gesture and the handler
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      panRef.current = {
        x: event.clientX,
        viewStart: geometry.start,
        span: geometry.span,
        fullSpan: geometry.fullSpan,
        plotWidth: geometry.plotWidth,
        moved: false,
      };
      pinchRef.current = null;
      setHoverIndex(hoverFromClientX(event.clientX, element));
      return;
    }

    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      const dist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const mid = (points[0].x + points[1].x) / 2;
      const rect = element.getBoundingClientRect();
      const fraction = clamp(
        (mid - rect.left - geometry.plotLeft) / geometry.plotWidth,
        0,
        1,
      );
      pinchRef.current = {
        dist: Math.max(1, dist),
        span: geometry.span,
        fullSpan: geometry.fullSpan,
        minSpan: geometry.minSpan,
        plotLeft: geometry.plotLeft,
        plotWidth: geometry.plotWidth,
        anchor: geometry.start + fraction * geometry.span,
      };
      panRef.current = null;
      setHoverIndex(null);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const element = event.currentTarget;

    if (!pointersRef.current.has(event.pointerId)) {
      if (event.pointerType !== "touch") setHoverIndex(hoverFromClientX(event.clientX, element));
      return;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size >= 2) {
      const pinch = pinchRef.current;
      if (!pinch) return;
      const points = [...pointersRef.current.values()];
      const dist = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      const rect = element.getBoundingClientRect();
      const mid = (points[0].x + points[1].x) / 2 - rect.left;
      const span = clamp(pinch.span * (pinch.dist / dist), pinch.minSpan, pinch.fullSpan);
      const fraction = clamp((mid - pinch.plotLeft) / pinch.plotWidth, 0, 1);
      const start = clamp(pinch.anchor - fraction * span, 0, pinch.fullSpan - span);
      setView(span >= pinch.fullSpan - 1e-6 ? null : { start, end: start + span });
      return;
    }

    const pan = panRef.current;
    if (!pan) {
      setHoverIndex(hoverFromClientX(event.clientX, element));
      return;
    }
    const dx = event.clientX - pan.x;
    if (!pan.moved) {
      if (Math.abs(dx) < 4) {
        setHoverIndex(hoverFromClientX(event.clientX, element));
        return;
      }
      pan.moved = true;
      setDragging(true);
    }
    if (pan.span < pan.fullSpan - 1e-6) {
      const start = clamp(
        pan.viewStart - (dx / pan.plotWidth) * pan.span,
        0,
        pan.fullSpan - pan.span,
      );
      setView({ start, end: start + pan.span });
    }
    setHoverIndex(null);
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    const element = event.currentTarget;
    pointersRef.current.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    if (pointersRef.current.size === 0) {
      panRef.current = null;
      pinchRef.current = null;
      setDragging(false);
      if (event.pointerType !== "touch") setHoverIndex(hoverFromClientX(event.clientX, element));
      return;
    }
    if (pointersRef.current.size === 1 && pinchRef.current) {
      const [remaining] = [...pointersRef.current.values()];
      panRef.current = {
        x: remaining.x,
        viewStart: viewState.start,
        span: viewState.span,
        fullSpan: viewState.fullSpan,
        plotWidth: geometry?.plotWidth ?? 1,
        moved: true,
      };
      pinchRef.current = null;
    }
  };

  const handlePointerCancel = () => {
    pointersRef.current.clear();
    panRef.current = null;
    pinchRef.current = null;
    setDragging(false);
  };

  const tipLeft =
    geometry && activeHover !== null
      ? (() => {
          const anchorX = geometry.x(activeHover);
          const preferred =
            anchorX + 16 + TIP_WIDTH > width - 8 ? anchorX - TIP_WIDTH - 16 : anchorX + 16;
          return clamp(preferred, 8, Math.max(8, width - TIP_WIDTH - 8));
        })()
      : 8;
  const tipTop =
    hovered && geometry
      ? clamp(geometry.y(hovered.close) - 96, 6, Math.max(6, height - TIP_HEIGHT))
      : 6;

  return (
    <div className="candle-chart">
      <div className="chart-toolbar">
        <button
          type="button"
          className={`chart-chip${showSma ? " on" : ""}`}
          onClick={() => setShowSma((value) => !value)}
          aria-pressed={showSma}
        >
          <span className="chart-swatch" style={{ background: SMA_COLOR }} />
          SMA 20
          <span className="chart-chip-value">{fmtPrice(indicators?.smaLast ?? null)}</span>
        </button>
        <button
          type="button"
          className={`chart-chip${showEma ? " on" : ""}`}
          onClick={() => setShowEma((value) => !value)}
          aria-pressed={showEma}
        >
          <span className="chart-swatch" style={{ background: EMA_COLOR }} />
          EMA 50
          <span className="chart-chip-value">{fmtPrice(indicators?.emaLast ?? null)}</span>
        </button>
        <div className="chart-actions">
          {!zoomed || width >= 480 ? (
            <span className="chart-hint">
              {width > 0 && width < 480
                ? zoomed
                  ? "Drag to pan"
                  : "Pinch to zoom"
                : zoomed
                  ? "Drag to pan · double-click resets"
                  : "Scroll to zoom · drag to pan"}
            </span>
          ) : null}
          {zoomed ? (
            <button
              type="button"
              className="chart-chip chart-reset"
              onClick={resetView}
              aria-label="Reset chart zoom"
              title={`Zoomed ${viewState.zoom.toFixed(1)}× — click to reset`}
            >
              <RotateCcw size={12} strokeWidth={2.4} />
              <span className="chart-reset-label">Reset</span>
              <span className="chart-chip-value">{viewState.zoom.toFixed(1)}×</span>
            </button>
          ) : null}
        </div>
      </div>

      <div ref={wrapRef} className="chart-shell" style={{ height }}>
        {geometry ? (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            role="img"
            aria-label={`Candlestick chart with ${candles.length} candles. Scroll or pinch to zoom, drag to pan.`}
            className={dragging ? "is-panning" : undefined}
            style={{ display: "block", touchAction: "pan-y" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerLeave={(event) => {
              if (event.pointerType !== "mouse") return;
              if (pointersRef.current.size > 0) return;
              setHoverIndex(null);
            }}
            onDoubleClick={resetView}
          >
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={geometry.plotLeft}
                  y={geometry.priceTop}
                  width={geometry.plotWidth}
                  height={geometry.volumeBase - geometry.priceTop}
                />
              </clipPath>
            </defs>

            {geometry.ticks.map((tick) => (
              <g key={tick}>
                <line
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={geometry.y(tick)}
                  y2={geometry.y(tick)}
                  stroke="var(--line)"
                  strokeDasharray="2 4"
                />
                <text
                  x={width - 6}
                  y={geometry.y(tick) + 3.5}
                  textAnchor="end"
                  fill="var(--text-3)"
                  fontSize={12.5}
                  fontFamily="var(--font-mono)"
                >
                  {shortPrice(tick)}
                </text>
              </g>
            ))}

            <g clipPath={`url(#${clipId})`}>
              {bandVisible && bandUpper !== null && bandLower !== null ? (
                <g>
                  <rect
                    x={geometry.plotLeft}
                    y={geometry.y(bandUpper)}
                    width={geometry.plotWidth}
                    height={Math.max(1, geometry.y(bandLower) - geometry.y(bandUpper))}
                    fill="var(--accent)"
                    opacity={0.07}
                  />
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={geometry.y(bandUpper)}
                    y2={geometry.y(bandUpper)}
                    stroke="var(--accent)"
                    strokeDasharray="4 4"
                    opacity={0.4}
                  />
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={geometry.y(bandLower)}
                    y2={geometry.y(bandLower)}
                    stroke="var(--accent)"
                    strokeDasharray="4 4"
                    opacity={0.4}
                  />
                </g>
              ) : null}

              {geometry.visible.map((candle, offset) => {
                const index = geometry.from + offset;
                const rising = candle.close >= candle.open;
                const color = rising ? UP : DOWN;
                const bodyTop = geometry.y(Math.max(candle.open, candle.close));
                const bodyHeight = Math.max(
                  1,
                  geometry.y(Math.min(candle.open, candle.close)) - bodyTop,
                );
                const barHeight = Math.max(
                  candle.volume > 0 ? 0.6 : 0,
                  (candle.volume / maxVolume) * VOLUME_HEIGHT,
                );
                return (
                  <g key={candle.timestamp}>
                    <line
                      x1={geometry.x(index)}
                      x2={geometry.x(index)}
                      y1={geometry.y(candle.high)}
                      y2={geometry.y(candle.low)}
                      stroke={color}
                      strokeWidth={geometry.plotWidth / geometry.count >= 6 ? 1.4 : 1}
                    />
                    <rect
                      x={geometry.x(index) - geometry.bodyWidth / 2}
                      y={bodyTop}
                      width={geometry.bodyWidth}
                      height={bodyHeight}
                      fill={color}
                      rx={geometry.bodyWidth > 3 ? 0.8 : 0}
                      opacity={0.92}
                    />
                    <rect
                      x={geometry.x(index) - geometry.bodyWidth / 2}
                      y={geometry.volumeBase - barHeight}
                      width={geometry.bodyWidth}
                      height={barHeight}
                      fill={color}
                      opacity={0.32}
                    />
                  </g>
                );
              })}

              {indicators?.smaPath ? (
                <path
                  d={indicators.smaPath}
                  fill="none"
                  stroke={SMA_COLOR}
                  strokeWidth={1.4}
                  opacity={0.9}
                />
              ) : null}
              {indicators?.emaPath ? (
                <path
                  d={indicators.emaPath}
                  fill="none"
                  stroke={EMA_COLOR}
                  strokeWidth={1.4}
                  opacity={0.85}
                />
              ) : null}

              {levels?.support && levels.support >= geometry.lo && levels.support <= geometry.hi ? (
                <g>
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={geometry.y(levels.support)}
                    y2={geometry.y(levels.support)}
                    stroke="var(--text-3)"
                    strokeDasharray="2 5"
                    opacity={0.55}
                  />
                  <text
                    x={geometry.plotRight - 4}
                    y={geometry.y(levels.support) + 12}
                    textAnchor="end"
                    fill="var(--text-3)"
                    fontSize={12}
                  >
                    S
                  </text>
                </g>
              ) : null}
              {levels?.resistance &&
              levels.resistance >= geometry.lo &&
              levels.resistance <= geometry.hi ? (
                <g>
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={geometry.y(levels.resistance)}
                    y2={geometry.y(levels.resistance)}
                    stroke="var(--text-3)"
                    strokeDasharray="2 5"
                    opacity={0.55}
                  />
                  <text
                    x={geometry.plotRight - 4}
                    y={geometry.y(levels.resistance) - 5}
                    textAnchor="end"
                    fill="var(--text-3)"
                    fontSize={12}
                  >
                    R
                  </text>
                </g>
              ) : null}

              {bandVisible && bandUpper !== null && bandLower !== null ? (
                <g pointerEvents="none">
                  <rect
                    x={geometry.plotLeft + 1}
                    y={clamp(
                      geometry.y(bandUpper) + 2,
                      geometry.priceTop + 2,
                      geometry.priceTop + geometry.priceHeight - 18,
                    )}
                    width={140}
                    height={17}
                    rx={3}
                    fill="var(--surface-2)"
                    opacity={0.92}
                  />
                  <text
                    x={geometry.plotLeft + 7}
                    y={
                      clamp(
                        geometry.y(bandUpper) + 2,
                        geometry.priceTop + 2,
                        geometry.priceTop + geometry.priceHeight - 18,
                      ) + 12
                    }
                    fill="var(--accent)"
                    fontSize={12}
                    fontWeight={600}
                  >
                    recommended range
                  </text>
                </g>
              ) : null}

              {showLastPill ? (
                <line
                  x1={geometry.plotLeft}
                  x2={geometry.plotRight}
                  y1={lastPillY}
                  y2={lastPillY}
                  stroke="var(--accent)"
                  strokeDasharray="4 4"
                  opacity={0.55}
                />
              ) : null}

              {activeHover !== null && hovered ? (
                <g pointerEvents="none">
                  <line
                    x1={geometry.x(activeHover)}
                    x2={geometry.x(activeHover)}
                    y1={geometry.priceTop}
                    y2={geometry.volumeBase}
                    stroke="var(--text-3)"
                    strokeDasharray="3 3"
                    opacity={0.7}
                  />
                  <line
                    x1={geometry.plotLeft}
                    x2={geometry.plotRight}
                    y1={geometry.y(hovered.close)}
                    y2={geometry.y(hovered.close)}
                    stroke="var(--text-3)"
                    strokeDasharray="3 3"
                    opacity={0.45}
                  />
                  <circle
                    cx={geometry.x(activeHover)}
                    cy={geometry.y(hovered.close)}
                    r={3.5}
                    fill="var(--surface)"
                    stroke="var(--accent)"
                    strokeWidth={1.6}
                  />
                </g>
              ) : null}
            </g>

            {showLastPill ? (
              <g pointerEvents="none">
                <rect
                  x={width - PAD.right + 2}
                  y={lastPillY - 10}
                  width={PAD.right - 6}
                  height={20}
                  rx={4}
                  fill="var(--accent)"
                />
                <text
                  x={width - PAD.right + 2 + (PAD.right - 6) / 2}
                  y={lastPillY + 4.6}
                  textAnchor="middle"
                  fill="var(--accent-ink)"
                  fontSize={12}
                  fontWeight={600}
                  fontFamily="var(--font-mono)"
                >
                  {shortPrice(lastCandle.close)}
                </text>
              </g>
            ) : null}

            {activeHover !== null &&
            hovered &&
            !(showLastPill && Math.abs(geometry.y(hovered.close) - lastPillY) < 16) ? (
              <g pointerEvents="none">
                <rect
                  x={width - PAD.right + 2}
                  y={clamp(
                    geometry.y(hovered.close) - 10,
                    geometry.priceTop,
                    geometry.priceTop + geometry.priceHeight - 20,
                  )}
                  width={PAD.right - 6}
                  height={20}
                  rx={4}
                  fill="var(--surface-3)"
                  stroke="var(--line-2)"
                />
                <text
                  x={width - PAD.right + 2 + (PAD.right - 6) / 2}
                  y={
                    clamp(
                      geometry.y(hovered.close) - 10,
                      geometry.priceTop,
                      geometry.priceTop + geometry.priceHeight - 20,
                    ) + 13.6
                  }
                  textAnchor="middle"
                  fill="var(--text-2)"
                  fontSize={12}
                  fontWeight={600}
                  fontFamily="var(--font-mono)"
                >
                  {shortPrice(hovered.close)}
                </text>
              </g>
            ) : null}

            {timeMarks.map((mark) => (
              <text
                key={`${mark.index}-${mark.label}`}
                x={geometry.x(mark.index)}
                y={height - 5}
                textAnchor={mark.anchor}
                fill="var(--text-3)"
                fontSize={12.5}
                fontFamily="var(--font-mono)"
              >
                {mark.label}
              </text>
            ))}
          </svg>
        ) : null}

        {hovered && geometry ? (
          <div className="chart-tip" style={{ left: tipLeft, top: tipTop }}>
            <div className="ct-date">{fmtDate(hovered.timestamp)}</div>
            <div className="ct-grid">
              <span>Open</span>
              <b>{fmtPrice(hovered.open)}</b>
              <span>High</span>
              <b>{fmtPrice(hovered.high)}</b>
              <span>Low</span>
              <b>{fmtPrice(hovered.low)}</b>
              <span>Close</span>
              <b className={hoverChange >= 0 ? "up" : "down"}>{fmtPrice(hovered.close)}</b>
            </div>
            {hoverSma !== null || hoverEma !== null ? (
              <div className="ct-ind">
                {hoverSma !== null ? (
                  <span style={{ color: SMA_COLOR }}>
                    SMA 20 <b>{fmtPrice(hoverSma)}</b>
                  </span>
                ) : null}
                {hoverEma !== null ? (
                  <span style={{ color: EMA_COLOR }}>
                    EMA 50 <b>{fmtPrice(hoverEma)}</b>
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="ct-foot">
              <span className={hoverChange >= 0 ? "up" : "down"}>
                {fmtPct(hoverChange, { sign: true, digits: 2 })}
              </span>
              <span>Vol {fmtCompact(hovered.volume)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
