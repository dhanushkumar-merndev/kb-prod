import { AppError } from "./errors.ts";

const DEFAULT_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

function configuredOrigins(): Set<string> {
  const value =
    Deno.env.get("CORS_ALLOWED_ORIGINS") ??
    Deno.env.get("APP_URL") ??
    Deno.env.get("NEXT_PUBLIC_APP_URL") ??
    "";

  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

function isLocalDevelopmentOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      DEFAULT_LOCAL_HOSTS.has(url.hostname)
    );
  } catch {
    return false;
  }
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-bootstrap-secret, x-request-id, x-session-code, x-session-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  // Server-to-server and command-line calls do not send Origin.
  if (!origin) {
    return headers;
  }

  const normalizedOrigin = origin.replace(/\/$/, "");
  if (configuredOrigins().has(normalizedOrigin) || isLocalDevelopmentOrigin(normalizedOrigin)) {
    headers["Access-Control-Allow-Origin"] = normalizedOrigin;
    return headers;
  }

  throw new AppError("CORS_ORIGIN_DENIED");
}
