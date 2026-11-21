export type ParsedRoute =
  | { kind: "landing" }
  | { kind: "host-intake" }
  | { kind: "host-workspace"; bootId: string }
  | { kind: "boutique"; bootId: string }
  | { kind: "not-found" };

export function parseRoute(pathname: string): ParsedRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized === "/") {
    return { kind: "landing" };
  }

  if (normalized === "/host") {
    return { kind: "host-intake" };
  }

  const hostMatch = /^\/host\/([^/]+)$/.exec(normalized);
  if (hostMatch) {
    try {
      const bootId = decodeURIComponent(hostMatch[1]);
      if (bootId.trim().length > 0) {
        return { kind: "host-workspace", bootId };
      }
    } catch {
      return { kind: "not-found" };
    }
  }

  const boutiqueMatch = /^\/b\/([^/]+)$/.exec(normalized);
  if (boutiqueMatch) {
    try {
      const bootId = decodeURIComponent(boutiqueMatch[1]);
      if (bootId.trim().length > 0) {
        return { kind: "boutique", bootId };
      }
    } catch {
      return { kind: "not-found" };
    }
  }

  return { kind: "not-found" };
}
