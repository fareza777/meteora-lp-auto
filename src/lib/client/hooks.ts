"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import type {
  ActivityRecord,
  BacktestRecord,
  BotRecord,
  BotStats,
  DashboardData,
  OhlcvCandle,
  PoolAnalysis,
  ScannerResponse,
  TransactionRecord,
} from "@/lib/types";

export interface PoolDetailResponse {
  analysis: PoolAnalysis;
  candles: OhlcvCandle[];
  days: number;
  timeframe: string;
}

export interface BotListResponse {
  bots: BotRecord[];
  stats: BotStats[];
}

export interface ActivityResponse {
  activity: ActivityRecord[];
  transactions: TransactionRecord[];
}

export interface ScannerParams {
  search?: string;
  protocol?: string;
  sort?: string;
  minTvl?: number;
  minScore?: number;
  maxRisk?: number;
  limit?: number;
}

function scannerKey(params: ScannerParams): string {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.protocol && params.protocol !== "all") query.set("protocol", params.protocol);
  if (params.sort) query.set("sort", params.sort);
  if (params.minTvl) query.set("minTvl", String(params.minTvl));
  if (params.minScore) query.set("minScore", String(params.minScore));
  if (params.maxRisk) query.set("maxRisk", String(params.maxRisk));
  query.set("limit", String(params.limit ?? 48));
  return `/api/scanner?${query.toString()}`;
}

const LIVE_REFRESH = 20_000;

export function useDashboard() {
  return useSWR<DashboardData>("/api/dashboard", {
    refreshInterval: LIVE_REFRESH,
    keepPreviousData: true,
  });
}

export function useScanner(params: ScannerParams) {
  return useSWR<ScannerResponse>(scannerKey(params), {
    refreshInterval: 90_000,
    keepPreviousData: true,
  });
}

export function usePoolDetail(
  protocol: string | null,
  address: string | null,
  days = 7,
  timeframe: "30m" | "1h" | "4h" = "1h",
) {
  return useSWR<PoolDetailResponse>(
    protocol && address
      ? `/api/pools/${protocol}/${address}?days=${days}&timeframe=${timeframe}`
      : null,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
}

export function useBots() {
  return useSWR<BotListResponse>("/api/bots", { refreshInterval: LIVE_REFRESH, keepPreviousData: true });
}

export function useBacktests() {
  return useSWR<{ backtests: BacktestRecord[] }>("/api/backtest", {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
}

export function useActivity(limit = 120) {
  return useSWR<ActivityResponse>(`/api/activity?limit=${limit}`, {
    refreshInterval: 25_000,
    keepPreviousData: true,
  });
}

export function useRefreshAll() {
  const { mutate } = useSWRConfig();
  return useCallback(
    () =>
      mutate(
        (key) => typeof key === "string" && key.startsWith("/api/"),
        undefined,
        { revalidate: true },
      ),
    [mutate],
  );
}

export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export { scannerKey };
