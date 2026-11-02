import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { getSessionUser } from "./auth";
import { rateLimit } from "./rate-limit";
import { redactSecrets } from "./security";
import type { ApiErrorBody, UserRecord } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code = "request_failed", details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function json<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      "Cache-Control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export async function api(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ApiError) {
      return json<ApiErrorBody>(
        { error: error.message, code: error.code, details: error.details },
        { status: error.status },
      );
    }
    if (error instanceof ZodError) {
      return json<ApiErrorBody>(
        {
          error: "Input validation failed.",
          code: "invalid_input",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error("[api]", redactSecrets(message));
    return json<ApiErrorBody>(
      {
        error:
          process.env.NODE_ENV === "development"
            ? redactSecrets(message)
            : "The server could not complete this request.",
        code: "internal_error",
      },
      { status: 500 },
    );
  }
}

export async function requireUser(): Promise<UserRecord> {
  const user = await getSessionUser();
  if (!user) throw new ApiError(401, "Authentication required.", "unauthorized");
  return user;
}

export async function readJson<T>(request: Request, schema: ZodType<T>, maxBytes = 64_000): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new ApiError(413, "Request body is too large.", "payload_too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.", "invalid_json");
  }
  return schema.parse(raw);
}

/**
 * CSRF defence: same-site cookies plus an Origin/Host match and a custom
 * header that simple cross-site form posts cannot set.
 */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get("x-tide-client") !== "web") {
    throw new ApiError(403, "Missing request origin marker.", "csrf_rejected");
  }
  const origin = request.headers.get("origin");
  if (!origin) throw new ApiError(403, "Missing origin header.", "csrf_rejected");
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new ApiError(403, "Invalid origin header.", "csrf_rejected");
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host || originUrl.host !== host) {
    throw new ApiError(403, "Cross-origin request rejected.", "csrf_rejected");
  }
}

export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function enforceRateLimit(key: string, limit: number, windowMs: number): void {
  const bucket = rateLimit(key, limit, windowMs);
  if (!bucket.ok) {
    throw new ApiError(429, "Too many requests. Slow down and try again.", "rate_limited", {
      retryAt: bucket.resetAt,
    });
  }
}
