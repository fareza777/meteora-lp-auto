import type { ApiErrorBody } from "@/lib/types";

export class ClientApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = "request_failed", details?: unknown) {
    super(message);
    this.name = "ClientApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-tide-client", "web");
  headers.set("accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ClientApiError(0, "Network unavailable. Check your connection and retry.", "network_error");
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const err = (body ?? {}) as ApiErrorBody;
    throw new ClientApiError(
      res.status,
      err.error || `Request failed with status ${res.status}.`,
      err.code || "request_failed",
      err.details,
    );
  }
  return body as T;
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ClientApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export function validationMessages(error: unknown): string[] {
  if (!(error instanceof ClientApiError) || !Array.isArray(error.details)) return [];
  return (error.details as Array<{ path?: string; message?: string }>).map((item) =>
    item.path ? `${item.path}: ${item.message ?? "invalid"}` : item.message ?? "invalid input",
  );
}
