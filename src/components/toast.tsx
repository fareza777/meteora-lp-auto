"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { errorMessage } from "@/lib/client/api";

type Tone = "success" | "error" | "info";

interface ToastItem {
  id: string;
  tone: Tone;
  title: string;
  message?: string;
}

interface ToastApi {
  push: (tone: Tone, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  fromError: (title: string, error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = {
  success: CircleCheck,
  error: TriangleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (tone: Tone, title: string, message?: string) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      setItems((current) => [...current.slice(-3), { id, tone, title, message }]);
      const timer = setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, message) => push("success", title, message),
      error: (title, message) => push("error", title, message),
      fromError: (title, error) => push("error", title, errorMessage(error)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <div key={item.id} className={`toast ${item.tone}`}>
              <span className="t-ic">
                <Icon />
              </span>
              <div className="grow">
                <div className="t-title">{item.title}</div>
                {item.message ? <div className="t-msg">{item.message}</div> : null}
              </div>
              <button className="t-close" onClick={() => dismiss(item.id)} aria-label="Dismiss">
                <X />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
