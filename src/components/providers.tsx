"use client";

import { SWRConfig } from "swr";
import { apiFetch } from "@/lib/client/api";
import { ToastProvider } from "./toast";

const fetcher = <T,>(key: string) => apiFetch<T>(key);

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: true,
        shouldRetryOnError: false,
        keepPreviousData: true,
        dedupingInterval: 4000,
      }}
    >
      <ToastProvider>{children}</ToastProvider>
    </SWRConfig>
  );
}
