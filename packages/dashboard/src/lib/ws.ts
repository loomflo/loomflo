export type SubscribeSpec = { all: true } | { projectIds: string[] };

export function wsUrl(baseUrl: string, token: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
  u.pathname = "/ws";
  u.searchParams.set("token", token);
  return u.toString();
}
