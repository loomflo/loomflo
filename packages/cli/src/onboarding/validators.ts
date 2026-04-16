import { isOAuthTokenValid } from "@loomflo/core";

export type ValidatorResult =
  | { ok: true }
  | { ok: false; reason: string; hint?: string };

export async function validateAnthropicOauth(): Promise<ValidatorResult> {
  const valid = await isOAuthTokenValid();
  if (valid) return { ok: true };
  return {
    ok: false,
    reason: "No valid Claude Code OAuth token found",
    hint: "Run `claude login` to authenticate, then re-run the wizard.",
  };
}

export async function validateAnthropicApiKey(apiKey: string): Promise<ValidatorResult> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: "Anthropic API key is invalid or revoked", hint: "Check the key in the console." };
    }
    return { ok: false, reason: `Anthropic API responded ${String(r.status)}` };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      hint: "Check your network connection.",
    };
  }
}

export interface OpenAICompatCreds {
  apiKey: string;
  baseUrl: string;
}

export async function validateOpenAICompat(creds: OpenAICompatCreds): Promise<ValidatorResult> {
  try {
    const url = new URL("models", creds.baseUrl.endsWith("/") ? creds.baseUrl : `${creds.baseUrl}/`);
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${creds.apiKey}` },
    });
    if (r.ok) {
      const body = (await r.json()) as { data?: unknown };
      if (Array.isArray(body.data)) return { ok: true };
      return { ok: false, reason: "Unexpected response shape from /models" };
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: "API key rejected", hint: "Check the key in your provider dashboard." };
    }
    return { ok: false, reason: `Provider responded ${String(r.status)}` };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      hint: "Check the baseUrl and your network connection.",
    };
  }
}
