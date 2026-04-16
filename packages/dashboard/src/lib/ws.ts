export type SubscribeSpec = { all: true } | { projectIds: string[] };

/**
 * Subprotocol identifier paired with the bearer token on the WebSocket
 * upgrade request (`Sec-WebSocket-Protocol: loomflo.bearer, <token>`).
 *
 * Keeping the token off the URL avoids browser history, DevTools Network
 * panels, and reverse-proxy access logs holding it in clear text.
 */
export const WS_SUBPROTOCOL_PREFIX = "loomflo.bearer";

/** Build the daemon WebSocket URL (no query string — auth rides in the subprotocol). */
export function wsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.search = "";
  return u.toString();
}

/** Build the ordered subprotocol list the browser sends on the WS upgrade. */
export function wsSubprotocols(token: string): [string, string] {
  return [WS_SUBPROTOCOL_PREFIX, token];
}
