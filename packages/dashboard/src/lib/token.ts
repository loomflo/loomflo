const KEY = "loomflo.token";
const HASH_RE = /(?:^|#|&)token=([^&]+)/;

export function readToken(): string | null {
  const hash = window.location.hash;
  const match = hash.match(HASH_RE);
  if (match && match[1]) {
    const token = decodeURIComponent(match[1]);
    sessionStorage.setItem(KEY, token);
    clearTokenFromHash();
    return token;
  }
  const stored = sessionStorage.getItem(KEY);
  return stored;
}

export function clearTokenFromHash(): void {
  const stripped = window.location.hash
    .replace(HASH_RE, "")
    .replace(/^#&?/, "")
    .replace(/^#$/, "");
  const newHash =
    stripped.length > 0 ? `#${stripped.replace(/^&/, "")}` : "";
  const newUrl = `${window.location.pathname}${window.location.search}${newHash}`;
  window.history.replaceState({}, "", newUrl);
}

export function clearStoredToken(): void {
  sessionStorage.removeItem(KEY);
}
