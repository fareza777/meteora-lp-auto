"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LayoutDashboard, RefreshCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="page">
      <div className="panel raised" style={{ maxWidth: 560, margin: "48px auto 0" }}>
        <div className="empty">
          <div className="empty-ic">
            <TriangleAlert />
          </div>
          <h4>This view hit an unexpected error</h4>
          <p>
            Your positions and settings are safe on the server. Retry this view, or return to the
            desk.
          </p>
          {error.digest ? <span className="dimtx mono">ref {error.digest}</span> : null}
          <div className="row gap6 mt8">
            <Button variant="primary" onClick={reset}>
              <RefreshCw />
              Retry
            </Button>
            <Link href="/dashboard" className="btn btn-outline">
              <LayoutDashboard />
              Desk
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
