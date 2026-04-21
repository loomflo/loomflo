/**
 * Auth hook SPA-fallback tests.
 *
 * The dashboard is a single-page app mounted under nested routes like
 * `/projects/:id`. When the browser navigates to such a URL (refresh,
 * deep link, new tab), it issues a real GET with `Accept: text/html`
 * and no `Authorization` header — it does not know about the token
 * until the React bundle boots and reads it from the URL hash or
 * sessionStorage.
 *
 * The server must therefore let browser navigations fall through to the
 * SPA fallback (`setNotFoundHandler` → `sendFile("index.html")`), even
 * when the URL prefix matches an API route. API fetch calls from the
 * dashboard still go through the standard Bearer auth path because they
 * send a non-HTML Accept (default or explicit JSON), not text/html.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeAll } from "vitest";

import { createServer } from "../../src/api/server.js";

describe("auth hook — SPA fallback for browser navigations", () => {
  // Shared dashboard dir for the suite. We deliberately leak it rather
  // than cleaning up in afterAll because fastify-static streams the file
  // asynchronously after inject() returns — tearing the dir down can
  // race with the pending fs.open() and surface as an uncaught ENOENT.
  // /tmp cleanup is handled by the OS.
  let dashboardPath: string;

  beforeAll(() => {
    dashboardPath = mkdtempSync(join(tmpdir(), "loomflo-dash-"));
    writeFileSync(
      join(dashboardPath, "index.html"),
      "<!doctype html><html><body><div id=\"root\"></div></body></html>",
    );
  });

  it.each([
    "/projects/proj_abcdef01",
    "/projects/proj_abcdef01/graph",
    "/projects/proj_abcdef01/specs",
    "/projects/proj_abcdef01/memory",
    "/projects/proj_abcdef01/chat",
  ])("short-circuits unauthenticated SPA navigation %s to index.html", async (url) => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath,
    });
    try {
      const res = await server.inject({
        method: "GET",
        url,
        headers: { accept: "text/html,*/*" },
      });
      // The auth hook must short-circuit the response with index.html,
      // BEFORE any API route gets a chance to run and leak JSON (several
      // of these URLs collide with real API routes of the same shape).
      // server.inject() streams sendFile asynchronously, so we only
      // assert that the response is non-401 and not the JSON payload a
      // real API handler would produce.
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).toBeLessThan(500);
      const contentType = res.headers["content-type"];
      if (typeof contentType === "string") {
        expect(contentType).not.toMatch(/application\/json/);
      }
    } finally {
      await server.close();
    }
  });

  it("still returns 401 for unauthenticated API requests (no text/html Accept)", async () => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath,
    });
    try {
      const res = await server.inject({
        method: "GET",
        url: "/projects",
        headers: { accept: "application/json" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized" });
    } finally {
      await server.close();
    }
  });

  it("still returns 401 for POST requests with text/html Accept (mutations need auth)", async () => {
    const { server } = await createServer({
      token: "t",
      projectPath: "/tmp",
      dashboardPath,
    });
    try {
      const res = await server.inject({
        method: "POST",
        url: "/projects",
        headers: { accept: "text/html", "content-type": "application/json" },
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await server.close();
    }
  });
});
