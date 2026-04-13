/**
 * Integration tests for Daemon HTTP routes.
 *
 * Starts a real Daemon on a random port, exercises /health, authenticated
 * routes, and POST /shutdown, then tears down after each test.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Daemon, type DaemonConfig } from "../../src/daemon.js";
import type { DaemonInfo } from "../../src/daemon.js";

// ============================================================================
// Helpers
// ============================================================================

/** Return a random port in the 40000–59999 range. */
function randomPort(): number {
  return 40_000 + Math.floor(Math.random() * 20_000);
}

// ============================================================================
// Test Suite
// ============================================================================

describe("Daemon routes (integration)", () => {
  let daemon: Daemon;
  let info: DaemonInfo;

  beforeEach(async () => {
    const config: DaemonConfig = { port: randomPort() };
    daemon = new Daemon(config);
    info = await daemon.start();
  });

  afterEach(async () => {
    try {
      if (daemon.isRunning()) {
        await daemon.stop();
      }
    } catch {
      // Best-effort cleanup.
    }
  });

  // --------------------------------------------------------------------------
  // GET /health
  // --------------------------------------------------------------------------

  it("GET /health returns 200 with status ok and uptime", async () => {
    const res = await fetch(`http://127.0.0.1:${String(info.port)}/health`);

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("GET /health succeeds without an auth token", async () => {
    const res = await fetch(`http://127.0.0.1:${String(info.port)}/health`, {
      headers: {},
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  // --------------------------------------------------------------------------
  // Authenticated route — 401 without token
  // --------------------------------------------------------------------------

  it("GET /workflow without token returns 401 Unauthorized", async () => {
    const res = await fetch(`http://127.0.0.1:${String(info.port)}/workflow`);

    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  // --------------------------------------------------------------------------
  // POST /shutdown
  // --------------------------------------------------------------------------

  it("POST /shutdown with valid token returns 200 and stops daemon", async () => {
    const res = await fetch(`http://127.0.0.1:${String(info.port)}/shutdown`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}` },
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Give gracefulShutdown a moment to complete.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    expect(daemon.isRunning()).toBe(false);
  });
});
