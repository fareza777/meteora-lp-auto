import { api, json, requireUser } from "@/lib/api";
import { scanPools, type ScanFilters } from "@/lib/market/scanner";
import { getUserSettings } from "@/lib/store";
import type { Protocol } from "@/lib/types";

const SORTS = new Set<NonNullable<ScanFilters["sort"]>>(["score", "feeApr", "tvl", "volume", "risk", "age"]);

export async function GET(request: Request) {
  return api(async () => {
    const user = await requireUser();
    const settings = getUserSettings(user.id);
    const url = new URL(request.url);
    const protocol = url.searchParams.get("protocol");
    const sort = url.searchParams.get("sort") ?? "score";
    const filters: ScanFilters = {
      protocols:
        protocol === "dlmm" || protocol === "damm-v2" ? ([protocol] as Protocol[]) : undefined,
      search: url.searchParams.get("search")?.trim() || undefined,
      minTvlUsd: Number(url.searchParams.get("minTvl") ?? 0) || undefined,
      minScore: Number(url.searchParams.get("minScore") ?? 0) || undefined,
      maxRiskScore: Number(url.searchParams.get("maxRisk") ?? 0) || undefined,
      sort: SORTS.has(sort as NonNullable<ScanFilters["sort"]>)
        ? (sort as NonNullable<ScanFilters["sort"]>)
        : "score",
      limit: Math.min(250, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40)),
      deep: url.searchParams.get("deep") !== "false",
    };
    const response = await scanPools(filters, settings.risk);
    return json(response);
  });
}
