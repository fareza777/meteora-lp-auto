"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { Button, Skeleton } from "./ui";

export function PageLoading({ label = "Loading your desk" }: { label?: string }) {
  return (
    <div className="page" aria-busy="true" aria-label={label}>
      <div className="page-head">
        <div className="lede col gap8">
          <Skeleton width={90} height={10} />
          <Skeleton width={260} height={30} />
          <Skeleton width={380} height={12} />
        </div>
        <Skeleton width={220} height={36} />
      </div>
      <div className="stats-strip">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="stat" key={index}>
            <Skeleton width={64} height={9} />
            <Skeleton width={96} height={20} className="mt12" />
            <Skeleton width={74} height={9} className="mt8" />
          </div>
        ))}
      </div>
      <div className="grid g2 mt16">
        <div className="panel">
          <div className="panel-body">
            <Skeleton width="45%" height={14} />
            <Skeleton width="100%" height={240} className="mt16" radius={12} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-body">
            <Skeleton width="40%" height={14} />
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} width="100%" height={40} className="mt12" radius={10} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PageError({
  title = "This view could not load",
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="page">
      <div className="panel raised" style={{ maxWidth: 560, margin: "48px auto 0" }}>
        <div className="empty">
          <div className="empty-ic">
            <TriangleAlert />
          </div>
          <h4>{title}</h4>
          <p>{message ?? "The server did not answer with usable data. Check the connection and retry."}</p>
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RefreshCw />
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
