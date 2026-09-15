export type AuthCallbackKind = "none" | "session" | "recovery";

const AUTH_QUERY_KEYS = ["code", "error", "error_description", "error_code"] as const;

type LocationParts = {
  pathname: string;
  search: string;
  hash: string;
};

let captured: LocationParts | null = null;

function paramsFromSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

function paramsFromHash(hash: string): URLSearchParams {
  return new URLSearchParams(hash.replace(/^#/, ""));
}

export function authCallbackKind(search: string, hash: string): AuthCallbackKind {
  const query = paramsFromSearch(search);
  const hashParams = paramsFromHash(hash);
  const hasCode = Boolean(query.get("code")?.trim());
  const hasAccessToken = Boolean(hashParams.get("access_token")?.trim());
  if (!hasCode && !hasAccessToken) return "none";
  const type = (query.get("type") || hashParams.get("type") || "").toLowerCase();
  if (type === "recovery") return "recovery";
  return "session";
}

export function pathAfterAuthCallback(kind: AuthCallbackKind): string | null {
  if (kind === "session") return "/";
  if (kind === "recovery") return "/reset-password";
  return null;
}

export function stripAuthCallbackLocation(pathname: string, search: string, hash: string): LocationParts {
  const kind = authCallbackKind(search, hash);
  const dest = pathAfterAuthCallback(kind);
  if (!dest) return { pathname, search, hash };

  const query = paramsFromSearch(search);
  for (const key of AUTH_QUERY_KEYS) query.delete(key);
  const type = query.get("type");
  if (type === "signup" || type === "email" || type === "magiclink" || type === "recovery" || type === "invite") {
    query.delete("type");
  }
  const nextSearch = query.toString();

  if (kind === "recovery") {
    return {
      pathname: dest,
      search: nextSearch ? `?${nextSearch}` : "",
      hash: "",
    };
  }

  return { pathname: "/", search: "", hash: "" };
}

export function captureAuthCallbackFromWindow(): LocationParts | null {
  if (typeof window === "undefined") return captured;
  if (!captured) {
    captured = {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    };
  }
  return captured;
}

export function capturedAuthCallbackKind(): AuthCallbackKind {
  const parts = captureAuthCallbackFromWindow();
  if (!parts) return "none";
  return authCallbackKind(parts.search, parts.hash);
}

export function replaceAuthCallbackUrl(): string | null {
  const parts = captureAuthCallbackFromWindow();
  if (!parts) return null;
  const kind = authCallbackKind(parts.search, parts.hash);
  const dest = pathAfterAuthCallback(kind);
  if (!dest || typeof window === "undefined") return dest;

  const cleaned = stripAuthCallbackLocation(parts.pathname, parts.search, parts.hash);
  const next = `${cleaned.pathname}${cleaned.search}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== next) {
    window.history.replaceState(window.history.state, "", next);
  }
  return dest;
}
