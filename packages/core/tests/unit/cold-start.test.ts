/**
 * Cold-start smoke test (P0-1 regression guard).
 *
 * When `Daemon.start()` runs against an empty Loomflo home directory, it must
 * seed a `default` provider profile so the S2 onboarding wizard has at least
 * one usable profile out of the box. Without this stub, the wizard's
 * `resolveProviderProfile` fails on a fresh machine.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Daemon } from "../../src/daemon.js";

describe("Daemon cold-start", () => {
  let home: string;
  let daemon: Daemon;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "loomflo-coldstart-"));
    daemon = new Daemon({ port: 0, host: "127.0.0.1", loomfloHome: home });
  });

  afterEach(async () => {
    await daemon.stop().catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  });

  it("creates a stub `default` profile when credentials.json is absent", async () => {
    const credPath = join(home, "credentials.json");

    // Sanity: the file truly does not exist before start().
    await expect(access(credPath)).rejects.toMatchObject({ code: "ENOENT" });

    await daemon.start();

    const raw = await readFile(credPath, "utf-8");
    const parsed = JSON.parse(raw) as { profiles: Record<string, { type: string }> };
    expect(parsed.profiles).toHaveProperty("default");
    expect(parsed.profiles["default"]).toEqual({ type: "anthropic-oauth" });

    const mode = (await stat(credPath)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("does not overwrite existing profiles", async () => {
    // Pre-seed credentials.json with a real profile.
    const { ProviderProfiles } = await import("../../src/providers/profiles.js");
    const profiles = new ProviderProfiles(join(home, "credentials.json"));
    await profiles.upsert("my-key", { type: "anthropic", apiKey: "sk-preexisting" });

    await daemon.start();

    const list = await profiles.list();
    expect(list).toHaveProperty("my-key");
    expect(list).not.toHaveProperty("default");
  });

  it("exposes a token and serves /health after cold-start", async () => {
    const info = await daemon.start();
    expect(info.token).toMatch(/^[0-9a-f]{64}$/);

    // `info.port` echoes the requested port (0 for ephemeral) — read the real
    // port from the underlying server address.
    const address = (
      daemon as unknown as { server: { server: { address: () => { port: number } } } }
    ).server.server.address();
    expect(address.port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${String(address.port)}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("full cold-start chain: daemon starts, stub profile is usable by the wizard", async () => {
    // This test verifies the complete cold-start-to-init contract:
    // 1. Daemon.start() on a virgin directory creates the stub profile.
    // 2. A ProviderProfiles reader (simulating the wizard) can resolve "default".
    // 3. The profile shape matches what validators expect.
    // 4. The daemon's /projects POST endpoint is reachable with the token.

    const info = await daemon.start();

    // Step 1+2: the wizard's resolveProviderProfile calls profiles.get("default").
    const { ProviderProfiles } = await import("../../src/providers/profiles.js");
    const profiles = new ProviderProfiles(join(home, "credentials.json"));
    const defaultProfile = await profiles.get("default");

    expect(defaultProfile).not.toBeNull();
    expect(defaultProfile!.type).toBe("anthropic-oauth");

    // Step 3: the profile shape matches the ProviderProfile discriminated union.
    // For "anthropic-oauth", the only required field is `type`. Ensure no
    // extraneous keys were introduced.
    expect(Object.keys(defaultProfile!)).toEqual(["type"]);

    // Step 4: verify the daemon's authenticated API is reachable.
    // The init command would POST to /projects to register the project.
    const address = (
      daemon as unknown as { server: { server: { address: () => { port: number } } } }
    ).server.server.address();
    const port = address.port;

    // Unauthenticated request to an API route should return 401.
    const unauthed = await fetch(`http://127.0.0.1:${String(port)}/projects`, {
      method: "GET",
    });
    expect(unauthed.status).toBe(401);

    // Authenticated request should succeed (empty project list).
    const authed = await fetch(`http://127.0.0.1:${String(port)}/daemon/status`, {
      headers: { authorization: `Bearer ${info.token}` },
    });
    expect(authed.status).toBe(200);
    const status = (await authed.json()) as { projectCount: number };
    expect(status.projectCount).toBe(0);

    // Step 5: verify /projects POST works (the init command's postProject call).
    const projectDir = join(home, "test-project");
    const { mkdir: mkdirFs } = await import("node:fs/promises");
    await mkdirFs(projectDir, { recursive: true });

    const registerRes = await fetch(`http://127.0.0.1:${String(port)}/projects`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${info.token}`,
      },
      body: JSON.stringify({
        id: "proj_deadbeef",
        name: "test-project",
        projectPath: projectDir,
        providerProfileId: "default",
      }),
    });
    expect(registerRes.status).toBe(201);
    const registered = (await registerRes.json()) as { id: string; name: string };
    expect(registered.id).toBe("proj_deadbeef");
    expect(registered.name).toBe("test-project");
  });
});
